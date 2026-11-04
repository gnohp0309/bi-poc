package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.regex.Pattern;

@Service
public class Chat {
  private final JdbcTemplate db;
  private final Datasets datasets;
  private final Queries queries;
  private final Auth auth;
  private final ObjectMapper mapper;
  private final HttpClient httpClient;
  private final String aiServiceUrl;

  Chat(JdbcTemplate db, Datasets datasets, Queries queries, Auth auth, ObjectMapper mapper,
       @Value("${poc.ai.service.url:http://127.0.0.1:8082}") String aiServiceUrl) {
    this.db = db;
    this.datasets = datasets;
    this.queries = queries;
    this.auth = auth;
    this.mapper = mapper;
    this.aiServiceUrl = aiServiceUrl;
    this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
  }

  public List<Map<String, Object>> listConversations(Auth.Actor actor) {
    return db.queryForList("""
        SELECT c.id, c.dataset_id, c.title, c.created_at, c.updated_at,
        d.name AS dataset_name,
        (SELECT count(*) FROM chat_messages WHERE conversation_id = c.id) AS message_count
        FROM conversations c
        JOIN datasets d ON d.id = c.dataset_id
        WHERE c.user_id = ?
        ORDER BY c.updated_at DESC
        LIMIT 50
        """, actor.id());
  }

  public Map<String, Object> getConversation(UUID id, Auth.Actor actor) {
    List<Map<String, Object>> rows = db.queryForList(
        "SELECT id, dataset_id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
        id, actor.id());
    if (rows.isEmpty()) throw Api.notFound();

    List<Map<String, Object>> messages = db.queryForList(
        "SELECT id, role, content, metadata_json, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC",
        id);

    Map<String, Object> result = new LinkedHashMap<>(rows.get(0));
    result.put("messages", messages);
    return result;
  }

  @Transactional
  public UUID createConversation(UUID datasetId, String title, Auth.Actor actor) {
    datasets.get(datasetId); // Check dataset exists
    UUID id = UUID.randomUUID();
    db.update("INSERT INTO conversations(id, user_id, dataset_id, title) VALUES (?, ?, ?, ?)",
        id, actor.id(), datasetId, title);
    auth.audit(actor, "CREATE", "CONVERSATION", id);
    return id;
  }

  @Transactional
  public Map<String, Object> sendMessage(UUID conversationId, String message, Auth.Actor actor) {
    // Get conversation and check ownership
    List<Map<String, Object>> convRows = db.queryForList(
        "SELECT c.id, c.dataset_id, d.connection_id FROM conversations c JOIN datasets d ON d.id = c.dataset_id WHERE c.id = ? AND c.user_id = ?",
        conversationId, actor.id());
    if (convRows.isEmpty()) throw Api.notFound();

    UUID datasetId = (UUID) convRows.get(0).get("dataset_id");
    UUID connectionId = (UUID) convRows.get(0).get("connection_id");

    // Save user message
    UUID userMsgId = UUID.randomUUID();
    db.update("INSERT INTO chat_messages(id, conversation_id, role, content) VALUES (?, ?, 'user', ?)",
        userMsgId, conversationId, message);

    // Get dataset metadata for AI
    Map<String, Object> dataset = datasets.get(datasetId);
    String source = datasets.source(dataset);

    // Get aliases for friendly column names
    Map<String, String> aliases = new LinkedHashMap<>();
    String aliasesJson = (String) dataset.get("aliases_json");
    if (aliasesJson != null && !aliasesJson.isEmpty() && !aliasesJson.equals("{}")) {
      try {
        @SuppressWarnings("unchecked")
        Map<String, Object> aliasesObj = mapper.readValue(aliasesJson, Map.class);
        @SuppressWarnings("unchecked")
        Map<String, String> aliasesMap = (Map<String, String>) aliasesObj.get("aliases");
        if (aliasesMap != null) {
          aliases = aliasesMap;
        }
      } catch (Exception e) {
        // Ignore alias parse errors
      }
    }

    @SuppressWarnings("unchecked")
    List<String> columns = (List<String>) queries.run(connectionId, "SELECT * FROM " + source + " LIMIT 0").get("columns");

    // Get column types
    List<Map<String, Object>> columnMetadata = new ArrayList<>();
    Map<String, Object> preview = queries.run(connectionId, "SELECT * FROM " + source + " LIMIT 5");
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> sampleRows = (List<Map<String, Object>>) preview.get("rows");

    for (String col : columns) {
      String type = inferColumnType(col, sampleRows);
      List<Object> samples = new ArrayList<>();
      for (int i = 0; i < Math.min(3, sampleRows.size()); i++) {
        samples.add(sampleRows.get(i).get(col));
      }

      Map<String, Object> colMeta = new LinkedHashMap<>();
      colMeta.put("name", col);
      colMeta.put("type", type);
      colMeta.put("sample_values", samples);

      // Add friendly name if alias exists
      if (aliases.containsKey(col)) {
        colMeta.put("friendly_name", aliases.get(col));
      }

      columnMetadata.add(colMeta);
    }

    // Call AI service
    String requestId = UUID.randomUUID().toString();

    // Get conversation history with summarization
    // Recent: last 10 messages (full detail)
    List<Map<String, Object>> history = db.queryForList(
        "SELECT role, content, metadata_json FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10",
        conversationId);
    Collections.reverse(history); // Oldest first

    List<Map<String, Object>> historyForAI = new ArrayList<>();
    for (Map<String, Object> msg : history) {
      Map<String, Object> historyMsg = new LinkedHashMap<>();
      historyMsg.put("role", msg.get("role"));
      historyMsg.put("content", msg.get("content"));

      // Parse metadata to get intent and query_config
      String metadataJson = (String) msg.get("metadata_json");
      if (metadataJson != null && !metadataJson.equals("{}")) {
        try {
          @SuppressWarnings("unchecked")
          Map<String, Object> meta = mapper.readValue(metadataJson, Map.class);
          if (meta.containsKey("intent")) {
            historyMsg.put("intent", meta.get("intent"));
          }
          if (meta.containsKey("query_config")) {
            historyMsg.put("query_config", meta.get("query_config"));
          }
        } catch (Exception ignored) {}
      }
      historyForAI.add(historyMsg);
    }

    // Older: messages beyond last 10 (summarized)
    String conversationSummary = null;
    int totalCount = db.queryForObject(
        "SELECT COUNT(*) FROM chat_messages WHERE conversation_id = ?",
        Integer.class, conversationId);

    if (totalCount > 10) {
      List<Map<String, Object>> olderMessages = db.queryForList(
          "SELECT role, content FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 40",
          conversationId);

      if (!olderMessages.isEmpty()) {
        conversationSummary = summarizeConversation(olderMessages);
      }
    }

    Map<String, Object> aiRequest = new LinkedHashMap<>();
    aiRequest.put("request_id", requestId);
    aiRequest.put("question", message);
    aiRequest.put("dataset_name", dataset.get("name").toString());
    aiRequest.put("columns", columnMetadata);
    aiRequest.put("conversation_history", historyForAI);
    if (conversationSummary != null) {
      aiRequest.put("conversation_summary", conversationSummary);
    }

    Map<String, Object> aiResponse;
    try {
      String requestBody = mapper.writeValueAsString(aiRequest);
      HttpRequest request = HttpRequest.newBuilder()
          .uri(URI.create(aiServiceUrl + "/analyze"))
          .header("Content-Type", "application/json")
          .timeout(Duration.ofSeconds(30))
          .POST(HttpRequest.BodyPublishers.ofString(requestBody))
          .build();

      HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200) {
        throw new RuntimeException("AI service error: " + response.statusCode());
      }
      @SuppressWarnings("unchecked")
      Map<String, Object> responseMap = mapper.readValue(response.body(), Map.class);
      aiResponse = responseMap;
    } catch (Exception e) {
      System.err.println("AI service error: " + e.getClass().getName() + ": " + e.getMessage());
      e.printStackTrace();
      String errorMsg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
      throw Api.bad("Xin lỗi, tôi không thể xử lý câu hỏi lúc này: " + errorMsg);
    }

    String intent = aiResponse.get("intent").toString();
    String answerText;
    Map<String, Object> queryResult = null;
    Map<String, Object> metadata = new LinkedHashMap<>();

    if ("clarify".equals(intent)) {
      answerText = aiResponse.get("clarification").toString();
    } else if ("query".equals(intent)) {
      // New approach: AI provides complete SQL
      String sqlTemplate = (String) aiResponse.get("sql");
      String template = (String) aiResponse.get("template");

      if (sqlTemplate == null || sqlTemplate.isEmpty()) {
        answerText = "Xin lỗi, tôi không thể tạo truy vấn cho câu hỏi này.";
      } else {
        // Replace {{table}} with actual table name
        String sql = sqlTemplate.replace("{{table}}", source);

        System.out.println("=== SQL FROM AI ===");
        System.out.println("Template: " + sqlTemplate);
        System.out.println("Actual SQL: " + sql);
        System.out.println("Template: " + template);

        // Validate SQL for basic safety
        if (!isValidSQL(sql)) {
          answerText = "Truy vấn không hợp lệ.";
        } else {
          try {
            queryResult = queries.run(connectionId, sql);
            answerText = formatAnswer(template, queryResult);

            System.out.println("=== RESULT ===");
            System.out.println("Rows: " + ((List<?>) queryResult.get("rows")).size());
            System.out.println("Answer: " + answerText);
          } catch (Exception e) {
            System.err.println("Query execution error: " + e.getMessage());
            answerText = "Lỗi khi thực thi truy vấn: " + e.getMessage();
          }
        }
      }
    } else {
      answerText = "Xin lỗi, tôi chưa hiểu câu hỏi của bạn.";
    }

    // Save assistant message
    UUID assistantMsgId = UUID.randomUUID();
    metadata.put("intent", intent);
    metadata.put("has_data", queryResult != null);
    if (queryResult != null) {
      metadata.put("row_count", ((List<?>) queryResult.get("rows")).size());
    }

    String metadataJson;
    try {
      metadataJson = mapper.writeValueAsString(metadata);
    } catch (Exception e) {
      metadataJson = "{}";
    }
    db.update("INSERT INTO chat_messages(id, conversation_id, role, content, metadata_json) VALUES (?, ?, 'assistant', ?, ?::jsonb)",
        assistantMsgId, conversationId, answerText, metadataJson);

    // Update conversation timestamp
    db.update("UPDATE conversations SET updated_at = now() WHERE id = ?", conversationId);

    auth.audit(actor, "CHAT_MESSAGE", "CONVERSATION", conversationId);

    Map<String, Object> result = new LinkedHashMap<>();
    result.put("message_id", assistantMsgId);
    result.put("intent", intent);
    result.put("answer", answerText);
    if (queryResult != null) {
      result.put("data", queryResult);
    }
    return result;
  }

  private boolean isValidSQL(String sql) {
    // Basic SQL injection prevention - whitelist approach
    if (sql == null || sql.isEmpty()) return false;

    String sqlUpper = sql.toUpperCase(Locale.ROOT);

    // Must start with SELECT
    if (!sqlUpper.trim().startsWith("SELECT")) return false;

    // Block dangerous keywords
    String[] blacklist = {
      "DROP", "DELETE", "TRUNCATE", "ALTER", "CREATE", "INSERT", "UPDATE",
      "EXEC", "EXECUTE", "GRANT", "REVOKE", "SHUTDOWN", "SCRIPT",
      "INTO OUTFILE", "INTO DUMPFILE", "LOAD_FILE"
    };

    for (String keyword : blacklist) {
      if (sqlUpper.contains(keyword)) {
        System.err.println("SQL blocked: contains " + keyword);
        return false;
      }
    }

    // Basic balance check for quotes and parentheses
    int singleQuotes = 0;
    int doubleQuotes = 0;
    int parens = 0;

    for (char c : sql.toCharArray()) {
      if (c == '\'') singleQuotes++;
      if (c == '"') doubleQuotes++;
      if (c == '(') parens++;
      if (c == ')') parens--;
    }

    if (singleQuotes % 2 != 0 || doubleQuotes % 2 != 0 || parens != 0) {
      System.err.println("SQL blocked: unbalanced quotes/parens");
      return false;
    }

    return true;
  }

  private String inferColumnType(String columnName, List<Map<String, Object>> sampleRows) {
    if (sampleRows.isEmpty()) return "TEXT";
    Object sample = null;
    for (Map<String, Object> row : sampleRows) {
      sample = row.get(columnName);
      if (sample != null) break;
    }
    if (sample == null) return "TEXT";
    if (sample instanceof Number) return "NUMERIC";
    if (sample instanceof java.sql.Date || sample instanceof java.sql.Timestamp) return "DATE";
    return "TEXT";
  }

  private Map<String, Object> normalizeQueryConfig(Map<String, Object> config) {
    Map<String, Object> normalized = new LinkedHashMap<>(config);

    // 1. Normalize aggregate: ["SUM"] -> "SUM", "sum" -> "SUM"
    Object agg = normalized.get("aggregate");
    if (agg instanceof List) {
      @SuppressWarnings("unchecked")
      List<?> aggList = (List<?>) agg;
      if (!aggList.isEmpty()) {
        agg = aggList.get(0);
      }
    }
    if (agg != null) {
      normalized.put("aggregate", agg.toString().toUpperCase(Locale.ROOT));
    }

    // 2. Normalize dimensions: dimension -> dimensions list
    if (normalized.containsKey("dimension") && !normalized.containsKey("dimensions")) {
      Object dim = normalized.get("dimension");
      if (dim != null && !"null".equals(dim.toString())) {
        normalized.put("dimensions", Collections.singletonList(dim.toString()));
      }
    }

    // 3. Normalize metrics - handle all formats
    Object metricsObj = normalized.get("metrics");
    if (metricsObj instanceof List) {
      @SuppressWarnings("unchecked")
      List<Object> metrics = new ArrayList<>((List<Object>) metricsObj);
      List<Map<String, String>> computedList = new ArrayList<>();

      // Get existing computed_metrics
      Object existingComputed = normalized.get("computed_metrics");
      if (existingComputed instanceof List) {
        @SuppressWarnings("unchecked")
        List<Map<String, String>> existing = (List<Map<String, String>>) existingComputed;
        computedList.addAll(existing);
      } else if (existingComputed instanceof Map) {
        // Normalize {key: expr} -> [{alias: key, expression: expr}]
        @SuppressWarnings("unchecked")
        Map<String, String> computedMap = (Map<String, String>) existingComputed;
        for (Map.Entry<String, String> entry : computedMap.entrySet()) {
          Map<String, String> item = new LinkedHashMap<>();
          item.put("alias", entry.getKey());
          item.put("expression", entry.getValue());
          computedList.add(item);
        }
      }

      // Process each metric
      List<Object> cleanMetrics = new ArrayList<>();
      for (Object m : metrics) {
        if (m == null) continue;

        if (m instanceof String) {
          String metricStr = (String) m;

          // SQL expression with ( or AS -> move to computed_metrics
          if (metricStr.contains("(") || metricStr.toUpperCase(Locale.ROOT).contains(" AS ")) {
            String expr, alias;
            if (metricStr.toUpperCase(Locale.ROOT).contains(" AS ")) {
              String[] parts = metricStr.split("\\s+[Aa][Ss]\\s+", 2);
              expr = parts[0].trim();
              alias = parts.length > 1 ? parts[1].trim() : "result";
            } else {
              expr = metricStr;
              alias = "result";
            }

            Map<String, String> computed = new LinkedHashMap<>();
            computed.put("expression", expr);
            computed.put("alias", alias);
            computedList.add(computed);
          } else {
            // Plain column name or column_suffix
            cleanMetrics.add(metricStr);
          }
        } else if (m instanceof Map) {
          // Normalize Map keys: field/name -> column
          @SuppressWarnings("unchecked")
          Map<String, Object> metricMap = new LinkedHashMap<>((Map<String, Object>) m);

          // Normalize key names
          if (metricMap.containsKey("field") && !metricMap.containsKey("column")) {
            metricMap.put("column", metricMap.remove("field"));
          } else if (metricMap.containsKey("name") && !metricMap.containsKey("column")) {
            metricMap.put("column", metricMap.remove("name"));
          }

          // Normalize aggregate key
          if (metricMap.containsKey("agg") && !metricMap.containsKey("aggregate")) {
            metricMap.put("aggregate", metricMap.remove("agg"));
          }
          if (metricMap.containsKey("aggregate")) {
            Object aggVal = metricMap.get("aggregate");
            metricMap.put("aggregate", aggVal.toString().toUpperCase(Locale.ROOT));
          }

          cleanMetrics.add(metricMap);
        } else {
          cleanMetrics.add(m);
        }
      }

      normalized.put("metrics", cleanMetrics);
      if (!computedList.isEmpty()) {
        normalized.put("computed_metrics", computedList);
      }
    }

    // 4. Normalize computed_metrics keys
    Object computedObj = normalized.get("computed_metrics");
    if (computedObj instanceof List) {
      @SuppressWarnings("unchecked")
      List<Map<String, String>> computedList = (List<Map<String, String>>) computedObj;
      for (Map<String, String> comp : computedList) {
        // Normalize expr -> expression
        if (comp.containsKey("expr") && !comp.containsKey("expression")) {
          comp.put("expression", comp.remove("expr"));
        }
        // Normalize name -> alias
        if (comp.containsKey("name") && !comp.containsKey("alias")) {
          comp.put("alias", comp.remove("name"));
        }
      }
    }

    // 5. Remove metrics that conflict with computed_metrics aliases
    metricsObj = normalized.get("metrics");
    computedObj = normalized.get("computed_metrics");
    if (metricsObj instanceof List && computedObj instanceof List) {
      @SuppressWarnings("unchecked")
      List<Object> metrics = new ArrayList<>((List<Object>) metricsObj);
      @SuppressWarnings("unchecked")
      List<Map<String, String>> computedList = (List<Map<String, String>>) computedObj;

      Set<String> computedAliases = new HashSet<>();
      for (Map<String, String> comp : computedList) {
        String alias = comp.get("alias");
        if (alias != null) {
          computedAliases.add(alias);
        }
      }

      metrics.removeIf(metric -> {
        if (metric == null) return true;
        String metricName = metric instanceof String ? (String) metric :
                           (metric instanceof Map ?
                             String.valueOf(((Map<?, ?>) metric).get("column")) : null);
        return metricName != null && computedAliases.contains(metricName);
      });

      normalized.put("metrics", metrics);
    }

    return normalized;
  }

  private String formatAnswer(String template, Map<String, Object> queryResult) {
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> rows = (List<Map<String, Object>>) queryResult.get("rows");

    if (rows.isEmpty()) {
      return "Không tìm thấy dữ liệu phù hợp.";
    }

    if (template == null || template.isEmpty()) {
      // Fallback: AI didn't provide template
      return formatRawData(rows);
    }

    // Smart detection: Does template contain placeholders?
    boolean hasPlaceholders = template.contains("{{") || template.contains("{");

    if (!hasPlaceholders) {
      // Pure text, no placeholders - just return as is
      return template;
    }

    // Check if single row result
    if (rows.size() == 1) {
      String result = template;
      for (Map.Entry<String, Object> entry : rows.get(0).entrySet()) {
        String key = entry.getKey();
        String value = formatValue(entry.getValue());
        // Case-insensitive replace
        result = result.replaceAll("(?i)\\{\\{" + Pattern.quote(key) + "\\}\\}", value);
        result = result.replaceAll("(?i)\\{" + Pattern.quote(key) + "\\}", value);
      }
      return result.trim();
    }

    // Multiple rows - template should be per-row format
    StringBuilder output = new StringBuilder();

    for (Map<String, Object> row : rows) {
      String rowText = template;

      for (Map.Entry<String, Object> entry : row.entrySet()) {
        String key = entry.getKey();
        String value = formatValue(entry.getValue());
        // Case-insensitive replace
        rowText = rowText.replaceAll("(?i)\\{\\{" + Pattern.quote(key) + "\\}\\}", value);
        rowText = rowText.replaceAll("(?i)\\{" + Pattern.quote(key) + "\\}", value);
      }

      output.append(rowText);

      // Add newline only if template doesn't end with one
      if (!rowText.endsWith("\n")) {
        output.append("\n");
      }
    }

    return output.toString().trim();
  }

  private String formatRawData(List<Map<String, Object>> rows) {
    // Fallback when AI doesn't provide template
    StringBuilder sb = new StringBuilder();
    for (Map<String, Object> row : rows) {
      sb.append("- ");
      boolean first = true;
      for (Map.Entry<String, Object> entry : row.entrySet()) {
        if (!first) sb.append(", ");
        first = false;
        sb.append(entry.getKey()).append(": ").append(formatValue(entry.getValue()));
      }
      sb.append("\n");
    }
    return sb.toString().trim();
  }

  private String formatValue(Object value) {
    if (value == null) return "";
    if (value instanceof Number) {
      return formatNumber(value);
    }
    return value.toString();
  }

  private String formatNumber(Object value) {
    if (value == null) return "0";
    if (value instanceof Number) {
      double d = ((Number) value).doubleValue();
      return String.format("%,.0f", d);
    }
    return value.toString();
  }

  private String buildComplexQuery(Map<String, Object> config, String source) {
    StringBuilder sql = new StringBuilder("SELECT ");

    // Dimensions
    @SuppressWarnings("unchecked")
    List<String> dimensions = (List<String>) config.get("dimensions");
    if (dimensions != null && !dimensions.isEmpty()) {
      for (int i = 0; i < dimensions.size(); i++) {
        if (i > 0) sql.append(", ");
        sql.append(Queries.identifier(dimensions.get(i)));
      }
      sql.append(", ");
    }

    // Metrics - accept both List<String> and List<Map<String, String>>
    @SuppressWarnings("unchecked")
    List<Object> metrics = (List<Object>) config.get("metrics");
    if (metrics != null && !metrics.isEmpty()) {
      for (int i = 0; i < metrics.size(); i++) {
        if (i > 0) sql.append(", ");

        Object metricObj = metrics.get(i);
        String agg, col, alias;

        if (metricObj instanceof String) {
          // Simple string format: "unit_price" or "units_in_stock_sum"
          String metricStr = (String) metricObj;
          col = metricStr;
          agg = (String) config.getOrDefault("aggregate", "AVG");

          // Strip common aggregate suffixes if present
          String[] knownAggs = {"_sum", "_avg", "_count", "_max", "_min", "_average"};
          for (String suffix : knownAggs) {
            if (metricStr.toLowerCase(Locale.ROOT).endsWith(suffix)) {
              col = metricStr.substring(0, metricStr.length() - suffix.length());
              agg = suffix.substring(1).toUpperCase(Locale.ROOT);
              if (agg.equals("AVERAGE")) agg = "AVG";
              break;
            }
          }

          alias = col + "_" + agg.toLowerCase();
        } else {
          // Map format: {"column": "amount", "aggregate": "sum", "alias": "total"}
          @SuppressWarnings("unchecked")
          Map<String, String> metric = (Map<String, String>) metricObj;
          agg = metric.get("aggregate").toUpperCase(Locale.ROOT);
          col = metric.get("column");
          alias = metric.getOrDefault("alias", col + "_" + agg.toLowerCase());
        }

        sql.append(agg.toUpperCase(Locale.ROOT)).append("(")
           .append(col.equals("*") ? "*" : Queries.identifier(col))
           .append(") AS ").append(Queries.identifier(alias));
      }
    }

    // Computed metrics
    @SuppressWarnings("unchecked")
    List<Map<String, String>> computedMetrics = (List<Map<String, String>>) config.get("computed_metrics");
    if (computedMetrics != null && !computedMetrics.isEmpty()) {
      for (int i = 0; i < computedMetrics.size(); i++) {
        if (i > 0 || (metrics != null && !metrics.isEmpty())) sql.append(", ");
        Map<String, String> computed = computedMetrics.get(i);
        String expression = computed.get("expression");
        String alias = computed.get("alias");
        String sanitizedExpr = sanitizeExpression(expression);
        sql.append("(").append(sanitizedExpr).append(") AS ").append(Queries.identifier(alias));
      }
    }

    sql.append(" FROM ").append(source);

    // Filters
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> filters = (List<Map<String, Object>>) config.get("filters");
    if (filters != null && !filters.isEmpty()) {
      sql.append(" WHERE ");
      for (int i = 0; i < filters.size(); i++) {
        if (i > 0) sql.append(" AND ");
        Map<String, Object> filter = filters.get(i);
        String column = Queries.identifier((String) filter.get("column"));
        String operator = (String) filter.get("operator");
        Object value = filter.get("value");

        sql.append(column).append(" ").append(operator).append(" ");
        if (value instanceof String) {
          sql.append("'").append(value.toString().replace("'", "''")).append("'");
        } else if (value instanceof List) {
          @SuppressWarnings("unchecked")
          List<?> values = (List<?>) value;
          sql.append("(");
          for (int j = 0; j < values.size(); j++) {
            if (j > 0) sql.append(", ");
            sql.append("'").append(values.get(j).toString().replace("'", "''")).append("'");
          }
          sql.append(")");
        } else {
          sql.append(value);
        }
      }
    }

    // GROUP BY
    if (dimensions != null && !dimensions.isEmpty()) {
      sql.append(" GROUP BY ");
      for (int i = 0; i < dimensions.size(); i++) {
        if (i > 0) sql.append(", ");
        sql.append(Queries.identifier(dimensions.get(i)));
      }
      sql.append(" ORDER BY ");
      for (int i = 0; i < dimensions.size(); i++) {
        if (i > 0) sql.append(", ");
        sql.append(Queries.identifier(dimensions.get(i)));
      }
    }

    sql.append(" LIMIT 100");
    return sql.toString();
  }

  private String sanitizeExpression(String expression) {
    String[] sqlKeywords = {"SUM", "AVG", "COUNT", "MIN", "MAX", "CAST", "CASE", "WHEN", "THEN", "ELSE", "END", "AND", "OR", "NOT", "EXTRACT", "QUARTER", "MONTH", "YEAR"};

    java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("\\b([a-z_][a-z0-9_]*)\\b", java.util.regex.Pattern.CASE_INSENSITIVE);
    java.util.regex.Matcher matcher = pattern.matcher(expression);
    StringBuffer sb = new StringBuffer();

    while (matcher.find()) {
      String word = matcher.group(1);
      boolean isKeyword = false;

      for (String keyword : sqlKeywords) {
        if (word.equalsIgnoreCase(keyword)) {
          isKeyword = true;
          break;
        }
      }

      if (isKeyword) {
        matcher.appendReplacement(sb, word.toUpperCase(Locale.ROOT));
      } else {
        matcher.appendReplacement(sb, Queries.identifier(word));
      }
    }
    matcher.appendTail(sb);

    return sb.toString();
  }

  private String summarizeConversation(List<Map<String, Object>> messages) {
    // Simple summary - just concatenate user questions, AI will understand
    StringBuilder summary = new StringBuilder();
    summary.append("Các câu hỏi trước: ");

    int count = 0;
    for (Map<String, Object> msg : messages) {
      String role = (String) msg.get("role");
      String content = (String) msg.get("content");

      if ("user".equals(role)) {
        if (count > 0) summary.append("; ");
        // Truncate long questions
        String question = content.length() > 50 ? content.substring(0, 50) + "..." : content;
        summary.append(question);
        count++;

        // Limit to first 5 questions for brevity
        if (count >= 5) {
          summary.append("...");
          break;
        }
      }
    }

    return summary.toString();
  }

  @Transactional
  public void deleteConversation(UUID id, Auth.Actor actor) {
    List<Map<String, Object>> rows = db.queryForList(
        "SELECT id FROM conversations WHERE id = ? AND user_id = ?", id, actor.id());
    if (rows.isEmpty()) throw Api.notFound();

    db.update("DELETE FROM chat_messages WHERE conversation_id = ?", id);
    db.update("DELETE FROM conversations WHERE id = ?", id);
    auth.audit(actor, "DELETE", "CONVERSATION", id);
  }

  @RestController
  @RequestMapping("/api/chat")
  public static class Controller {
    private final Chat service;
    private final Auth auth;

    Controller(Chat service, Auth auth) {
      this.service = service;
      this.auth = auth;
    }

    @GetMapping("/conversations")
    List<Map<String, Object>> listConversations(HttpServletRequest request) {
      return service.listConversations(auth.actor(request));
    }

    @PostMapping("/conversations")
    Map<String, Object> createConversation(@RequestBody Map<String, Object> body, HttpServletRequest request) {
      Auth.Actor actor = auth.actor(request);
      UUID datasetId = Api.uuid(Api.text(body, "datasetId"));
      String title = Api.optional(body, "title");
      if (title.isEmpty()) title = "Cuộc hội thoại mới";
      return Map.of("id", service.createConversation(datasetId, title, actor));
    }

    @GetMapping("/conversations/{id}")
    Map<String, Object> getConversation(@PathVariable String id, HttpServletRequest request) {
      return service.getConversation(Api.uuid(id), auth.actor(request));
    }

    @PostMapping("/message")
    Map<String, Object> sendMessage(@RequestBody Map<String, Object> body, HttpServletRequest request) {
      UUID conversationId = Api.uuid(Api.text(body, "conversationId"));
      String message = Api.text(body, "message");
      return service.sendMessage(conversationId, message, auth.actor(request));
    }

    @DeleteMapping("/conversations/{id}")
    Map<String, Object> deleteConversation(@PathVariable String id, HttpServletRequest request) {
      service.deleteConversation(Api.uuid(id), auth.actor(request));
      return Map.of("success", true);
    }
  }
}
