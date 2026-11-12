package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

@Service
class ChatVerification {
  private final JdbcTemplate db;
  private final DatasetAnalysis analysis;
  private final DashboardInteraction dashboards;
  private final Auth auth;
  private final ObjectMapper mapper;
  private final ObjectReader metadataReader;

  ChatVerification(JdbcTemplate db, DatasetAnalysis analysis, DashboardInteraction dashboards, Auth auth, ObjectMapper mapper) {
    this.db = db;
    this.analysis = analysis;
    this.dashboards = dashboards;
    this.auth = auth;
    this.mapper = mapper;
    this.metadataReader = mapper.reader().with(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS);
  }

  private record Message(UUID datasetId, long sequence, String metadata) {}
  record Scope(String aggregate, String column, List<DatasetAnalysis.Filter> filters) {}
  record Result(String status, String reason, String dataset, Scope expected, Scope actual,
                String answerValue, String computedValue, Long matchingRows) {}
  private record Observed(Scope scope, JsonNode value, boolean grouped) {}

  Result verify(UUID conversation, UUID message, Auth.Actor actor) {
    var stored = db.query("""
        SELECT c.dataset_id,m.sequence,m.metadata_json FROM conversations c
        JOIN chat_messages m ON m.conversation_id=c.id
        WHERE c.id=? AND c.user_id=? AND m.id=? AND m.role='assistant'
        """, (rs, n) -> new Message(rs.getObject(1, UUID.class), rs.getLong(2), rs.getString(3)),
        conversation, actor.id(), message).stream().findFirst().orElseThrow(Api::notFound);
    auth.canEdit(actor);
    try {
      JsonNode saved = metadataReader.readTree(stored.metadata());
      if (saved.path("query_config").isObject()) return verifyQuery(conversation, stored, saved, actor);
      if (saved.path("dashboard_id").isTextual()) return verifyKpi(conversation, stored, saved, actor);
      return unavailable("Tin nhắn này chưa có kết quả số liệu hỗ trợ kiểm chứng.");
    } catch (java.io.IOException | IllegalArgumentException e) {
      return unavailable("Thông tin đã lưu của câu trả lời chưa đủ để kiểm chứng.");
    } catch (Api.Failure e) {
      if (e.status == 403) throw e;
      return unavailable("Chưa đọc được dữ liệu để kiểm chứng. " + e.getMessage());
    }
  }

  private Result verifyQuery(UUID conversation, Message message, JsonNode saved, Auth.Actor actor) throws java.io.IOException {
    var metadata = analysis.metadata(message.datasetId());
    var expected = new VerificationQuestion(metadata).query(question(conversation, message.sequence(), saved));
    if (expected.isEmpty())
      return unavailable("Hãy nêu rõ phép tổng hợp, tên cột hoặc số dòng cần đếm và phạm vi muốn kiểm tra.");
    var plan = DatasetAnalysis.requestReader(mapper).<DatasetAnalysis.Request>readValue(saved.path("query_config"));
    var metrics = plan.metrics();
    if (metrics == null || metrics.size() != 1 || metrics.get(0) == null)
      return unavailable("Bản kiểm chứng này cần một chỉ số tổng hợp trong câu trả lời.");
    var metric = metrics.get(0);
    JsonNode rows = saved.path("data").path("rows");
    JsonNode value = rows.size() == 1 ? rows.path(0).path(metric.alias()) : null;
    var filters = plan.filters() == null ? List.<DatasetAnalysis.Filter>of() : plan.filters().stream()
        .map(f -> VerificationQuestion.canonical(f, metadata)).toList();
    var observed = new Observed(new Scope(metric.aggregate(), metric.column(), filters), value,
        plan.groupBy() != null && !plan.groupBy().isEmpty());
    return compare(metadata, expected.get(), observed, false, actor);
  }

  private Result verifyKpi(UUID conversation, Message message, JsonNode saved, Auth.Actor actor) throws java.io.IOException {
    UUID dashboardId = UUID.fromString(saved.path("dashboard_id").asText());
    var metadata = analysis.metadata(message.datasetId());
    var parser = new VerificationQuestion(metadata);
    var turns = db.query("""
        SELECT sequence,metadata_json FROM chat_messages WHERE conversation_id=? AND role='assistant'
        AND metadata_json LIKE ? ORDER BY sequence LIMIT 51
        """, (rs, n) -> new Message(message.datasetId(), rs.getLong(1), rs.getString(2)), conversation, "%" + dashboardId + "%");
    if (turns.size() > 50) return unavailable("Lịch sử dashboard quá dài để kiểm tra KPI trong Chat.");
    List<DatasetAnalysis.Filter> filters = new ArrayList<>();
    VerificationQuestion.Metric metric = null;
    boolean known = false;
    for (var turn : turns) {
      JsonNode state = metadataReader.readTree(turn.metadata());
      if (!dashboardId.toString().equals(state.path("dashboard_id").asText()) || state.has("dashboard_export")) continue;
      String prompt = question(conversation, turn.sequence(), state);
      if ("create_dashboard".equals(state.path("intent").asText())) {
        var origin = parser.dashboard(prompt);
        if (origin.isEmpty()) return unavailable("Cần câu tạo dashboard có phạm vi rõ ràng để kiểm chứng KPI.");
        filters.addAll(origin.get().filters());
        known = true;
      } else if ("dashboard_action".equals(state.path("intent").asText())) {
        var change = parser.dashboardUpdate(prompt);
        if (change.isEmpty()) return unavailable("Cần làm rõ chỉ số KPI hoặc các bộ lọc đã yêu cầu trong Chat.");
        var update = change.get().expected();
        if (change.get().addsMetric()) metric = update.metric();
        for (var filter : update.filters()) {
          filters.removeIf(f -> f.column().equals(filter.column()) && f.operator().equals(filter.operator()));
          filters.add(filter);
        }
      }
    }
    if (!known || metric == null) return unavailable("Cần một yêu cầu thêm KPI nêu rõ phép tính và chỉ số trong Chat.");
    return compareKpi(dashboardId, metadata, new VerificationQuestion.Expected(metric, filters), actor);
  }

  private Result compareKpi(UUID dashboardId, DatasetAnalysis.Metadata metadata, VerificationQuestion.Expected expected, Auth.Actor actor) {
    JsonNode dashboard = mapper.valueToTree(dashboards.query(dashboardId, Map.of()));
    var candidates = new ArrayList<JsonNode>();
    for (JsonNode chart : dashboard.path("charts")) {
      if ("kpi".equals(chart.path("chartType").asText()) && metadata.datasetId().toString().equals(chart.path("datasetId").asText()))
        candidates.add(chart);
    }
    var metric = expected.metric();
    var matching = candidates.stream().filter(c -> metric.column().equals(c.path("metric").asText())
        && metric.aggregate().equals(c.path("aggregate").asText())).toList();
    var kpi = matching.size() == 1 ? matching.get(0) : candidates.size() == 1 ? candidates.get(0) : null;
    if (kpi == null) return unavailable("Cần xác định thẻ KPI hiện tại tương ứng với yêu cầu trong Chat.");
    var actual = new Scope(kpi.path("aggregate").asText(), kpi.path("metric").asText(),
        dashboardFilters(dashboard.path("scopeFilters"), metadata));
    return compare(metadata, expected, new Observed(actual, kpi.path("rows").path(0).path("value"), false), true, actor);
  }

  private String question(UUID conversation, long sequence, JsonNode saved) {
    if (saved.hasNonNull("question_id")) {
      return db.queryForList("SELECT content FROM chat_messages WHERE conversation_id=? AND id=? AND role='user' AND sequence<?",
          String.class, conversation, UUID.fromString(saved.path("question_id").asText()), sequence)
          .stream().findFirst().orElse("");
    }
    // Older replies were inserted directly after their question.
    return db.queryForList("""
        SELECT content FROM (SELECT content,role FROM chat_messages WHERE conversation_id=? AND sequence<?
        ORDER BY sequence DESC LIMIT 1) previous WHERE role='user'
        """, String.class, conversation, sequence).stream().findFirst().orElse("");
  }

  private List<DatasetAnalysis.Filter> dashboardFilters(JsonNode filters, DatasetAnalysis.Metadata metadata) {
    var actual = new ArrayList<DatasetAnalysis.Filter>();
    for (var filter : filters) {
      if (!metadata.datasetId().toString().equals(filter.path("datasetId").asText())) continue;
      String column = filter.path("column").asText();
      switch (filter.path("op").asText()) {
        case "eq" -> actual.add(VerificationQuestion.filter(column, "eq", filter.path("value").asText()));
        case "null" -> actual.add(new DatasetAnalysis.Filter(column, "is_null", null));
        case "date" -> {
          var date = metadata.columns().stream().filter(c -> c.name().equals(column)).findFirst()
              .orElseThrow(() -> Api.bad("Không đọc được cột ngày"));
          actual.add(VerificationQuestion.dateFilter(date, "gte", LocalDate.parse(filter.path("value").asText())));
          actual.add(VerificationQuestion.dateFilter(date, "lt", LocalDate.parse(filter.path("end").asText()).plusDays(1)));
        }
        default -> throw Api.bad("Không đọc được bộ lọc dashboard");
      }
    }
    return actual;
  }

  private Result compare(DatasetAnalysis.Metadata metadata, VerificationQuestion.Expected expected, Observed observed,
                         boolean kpi, Auth.Actor actor) {
    var metric = expected.metric();
    var metrics = List.of(new DatasetAnalysis.Metric(metric.column(), metric.aggregate(), "verified_value"),
        new DatasetAnalysis.Metric(metric.column(), "count", "evidence_rows"));
    var request = new DatasetAnalysis.Request(null, metrics, expected.filters(), null, 1);
    JsonNode calculation = mapper.valueToTree(analysis.analyze(metadata.datasetId(), mapper.valueToTree(request), actor,
        kpi && !metric.aggregate().equals("count") ? metric.column() : null));
    var row = calculation.path("rows").path(0);
    var actual = observed.scope();
    var reference = new Scope(metric.aggregate(), metric.column(), expected.filters());
    String given = decimal(observed.value());
    String computed = decimal(row.path("verified_value"));
    Long count = row.path("evidence_rows").isIntegralNumber() ? row.path("evidence_rows").longValue() : null;
    var missing = expected.filters().stream().filter(f -> !actual.filters().contains(f)).toList();
    var extra = actual.filters().stream().filter(f -> !expected.filters().contains(f)).toList();
    var reasons = new ArrayList<String>();
    if (!missing.isEmpty()) reasons.add("Thiếu bộ lọc " + describe(missing));
    if (!extra.isEmpty()) reasons.add("Có bộ lọc ngoài yêu cầu " + describe(extra));
    if (observed.grouped()) reasons.add("Câu trả lời chia nhóm trong khi câu hỏi yêu cầu một giá trị");
    if (!metric.aggregate().equals(actual.aggregate()) || !metric.column().equals(actual.column()))
      reasons.add("Chỉ số hoặc phép tổng hợp khác câu hỏi");
    if (!reasons.isEmpty())
      return new Result("scope_mismatch", String.join(". ", reasons) + ".", metadata.name(), reference, actual, given, computed, count);
    if (given == null || computed == null)
      return new Result("insufficient", "Chưa có giá trị số hữu hạn ở cả hai phía để đối chiếu.",
          metadata.name(), reference, actual, given, computed, count);
    boolean same = new BigDecimal(given).compareTo(new BigDecimal(computed)) == 0;
    return new Result(same ? "match" : "value_mismatch",
        same ? "Chỉ số, bộ lọc và kết quả khớp dữ liệu được truy vấn." : "Giá trị đã trả khác kết quả tính lại từ dữ liệu hiện tại.",
        metadata.name(), reference, actual, given, computed, count);
  }

  private static String describe(List<DatasetAnalysis.Filter> filters) {
    return String.join(", ", filters.stream().map(f -> f.column() + " " + switch (f.operator()) {
      case "eq" -> "=";
      case "gte" -> "≥";
      case "lt" -> "<";
      default -> f.operator();
    } + (f.value() == null ? "" : " " + f.value().asText())).toList());
  }

  private static String decimal(JsonNode value) {
    if (value == null || !value.isNumber() || value.isFloatingPointNumber() && !Double.isFinite(value.asDouble())) return null;
    return value.decimalValue().stripTrailingZeros().toPlainString();
  }

  private static Result unavailable(String reason) {
    return new Result("insufficient", reason, null, null, null, null, null, null);
  }

  @RestController
  @RequestMapping("/api/chat/conversations/{conversationId}/messages/{messageId}/verification")
  static class Controller {
    private final ChatVerification verification;
    private final Auth auth;
    Controller(ChatVerification verification, Auth auth) {
      this.verification = verification;
      this.auth = auth;
    }

    @PostMapping
    Result verify(@PathVariable String conversationId, @PathVariable String messageId, HttpServletRequest request) {
      return verification.verify(Api.uuid(conversationId), Api.uuid(messageId), auth.actor(request));
    }
  }
}
