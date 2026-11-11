package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Pattern;

@Service
class ChatDashboardActions {
  private static final Pattern EDIT = Pattern.compile("\\b(?:them|gan|bo sung|tao them)\\b.*\\bkpi\\b");
  private static final Pattern FILTER = Pattern.compile("\\bloc\\b");
  private static final Pattern EXPORT = Pattern.compile("\\b(?:xuat|tai|download|export)\\b.*\\b(?:excel|xlsx|png|pdf)\\b");
  private static final Pattern EXPORT_FORMAT = Pattern.compile("\\b(excel|xlsx|png|pdf)\\b");
  private static final Pattern NON_COMMAND = Pattern.compile(
      "^(?:cach|huong dan|lam sao|tai sao|vi sao|neu|giai thich|mo ta|how|why)\\b"
          +"|\\b(?:hoi cach|co the cach nao)\\b|\\b(?:khong|dung|chua) (?:can |muon |duoc )?(?:them|gan|bo sung|tao them|loc|xuat|tai)\\b");
  private static final Pattern DASHBOARD_REFERENCE = Pattern.compile("\\b(?:dashboard|bang dieu khien|bang tong quan)\\b");
  private static final Pattern READ_REQUEST = Pattern.compile("^(?:(?:cho|giup) (?:tui|toi|minh|em) )?(?:xem|thong ke|phan tich|tinh|bao cao)\\b");
  private static final Set<String> FORMATS = Set.of("xlsx", "png", "pdf");
  private final JdbcTemplate db;
  private final ObjectMapper mapper;
  private final DashboardInteraction interaction;
  private final Charts charts;
  private final Dashboards dashboards;

  ChatDashboardActions(JdbcTemplate db, ObjectMapper mapper, DashboardInteraction interaction, Charts charts, Dashboards dashboards) {
    this.db = db;
    this.mapper = mapper;
    this.interaction = interaction;
    this.charts = charts;
    this.dashboards = dashboards;
  }

  record Target(UUID id, String name) {}
  record Outcome(String answer, String format) {}

  static Set<String> requestedActions(String message) {
    String normalized = Chat.normalizedWords(message);
    if (NON_COMMAND.matcher(normalized).find() || READ_REQUEST.matcher(normalized).find() || Chat.requestsDashboard(message)) return Set.of();
    Set<String> actions = new LinkedHashSet<>();
    if (EDIT.matcher(normalized).find()) actions.add("add_kpi");
    if (FILTER.matcher(normalized).find() && (DASHBOARD_REFERENCE.matcher(normalized).find()
        || normalized.matches("^(?:hay |giup toi |giup tui |cho toi |cho tui |toi muon |tui muon )?loc\\b.*")
        || actions.contains("add_kpi"))) actions.add("filters");
    if (EXPORT.matcher(normalized).find()) actions.add("export_format");
    return actions;
  }

  static Set<String> exportFormats(String message) {
    var matcher=EXPORT_FORMAT.matcher(Chat.normalizedWords(message));
    Set<String> formats=new LinkedHashSet<>();
    while(matcher.find()) formats.add(matcher.group(1).equals("excel")?"xlsx":matcher.group(1));
    return formats;
  }

  Optional<Target> latest(UUID conversationId, Auth.Actor actor) {
    var messages = db.queryForList("""
        SELECT metadata_json FROM chat_messages
        WHERE conversation_id=? AND role='assistant' AND metadata_json LIKE '%"dashboard_id"%'
        ORDER BY sequence DESC LIMIT 1
        """, String.class, conversationId);
    if (messages.isEmpty()) return Optional.empty();
    UUID id;
    try {
      id = UUID.fromString(mapper.readTree(messages.get(0)).path("dashboard_id").asText());
    } catch (java.io.IOException | IllegalArgumentException e) {
      return Optional.empty();
    }
    return db.query("SELECT name FROM dashboards WHERE id=? AND owner_id=?",
        (rs, n) -> new Target(id, rs.getString("name")), id, actor.id()).stream().findFirst();
  }

  Outcome apply(Target target, UUID datasetId, JsonNode command, Set<String> requested, Auth.Actor actor) {
    if (command == null || !command.isObject() || command.isEmpty()) throw Api.bad("Yêu cầu dashboard chưa hợp lệ");
    Set<String> keys = new HashSet<>();
    command.fieldNames().forEachRemaining(keys::add);
    if (!keys.equals(requested)) throw Api.bad("AI chưa hiểu đủ thao tác dashboard. Hãy ghi rõ yêu cầu hoặc gửi từng thao tác.");
    if (db.queryForList("SELECT id FROM dashboards WHERE id=? AND owner_id=? FOR UPDATE", target.id(), actor.id()).isEmpty())
      throw Api.notFound();

    var messages = new ArrayList<String>();
    if (keys.contains("add_kpi")) {
      addKpi(target.id(), datasetId, command.get("add_kpi"), actor);
      messages.add("Đã cập nhật thẻ KPI");
    }
    if (keys.contains("filters")) {
      var filters = Chat.scopedFilters(command.get("filters"), datasetId, mapper);
      if (filters.isEmpty()) throw Api.bad("Cần ít nhất một điều kiện lọc");
      var scope = new ArrayList<>(interaction.savedScope(target.id()));
      for (var filter : filters) {
        scope.removeIf(existing -> existing.get("datasetId").equals(filter.get("datasetId"))
            && existing.get("column").equals(filter.get("column")));
        scope.add(filter);
      }
      dashboards.saveScope(target.id(), scope, actor);
      messages.add("Đã áp dụng và lưu bộ lọc");
    }
    String format = command.path("export_format").asText("");
    if (keys.contains("export_format")) {
      if (!FORMATS.contains(format)) throw Api.bad("Chọn định dạng Excel, PDF hoặc PNG");
      messages.add("Có thể tải " + (format.equals("xlsx") ? "Excel" : format.toUpperCase(Locale.ROOT)) + " từ phản hồi này");
    }
    return new Outcome("Dashboard “" + target.name() + "”. " + String.join(". ", messages) + ".", format);
  }

  private void addKpi(UUID dashboard, UUID dataset, JsonNode input, Auth.Actor actor) {
    if (!input.isObject() || input.size() != 3) throw Api.bad("KPI cần tên, cột chỉ số và phép tổng hợp");
    String name = Chat.bounded(input.path("name").asText(""), 120, "Tên KPI");
    String metric = Chat.bounded(input.path("metric").asText(""), 120, "Cột KPI");
    String aggregate = input.path("aggregate").asText("");
    if (!Set.of("sum", "avg", "count").contains(aggregate)) throw Api.bad("Phép tổng hợp KPI không hợp lệ");
    var members = interaction.members(dashboard);
    var existing = members.stream().map(m -> charts.definition((UUID)m.get("chart_id"))).toList();
    if (existing.stream().anyMatch(c -> dataset.toString().equals(c.get("datasetId").toString()) && name.equals(c.get("name"))
        && "kpi".equals(c.get("chartType")) && metric.equals(c.get("metric")) && aggregate.equals(c.get("aggregate")))) return;
    var spec = Map.<String,Object>of("datasetId", dataset.toString(), "name", name, "chartType", "kpi", "dimension", "",
        "metric", metric, "aggregate", aggregate);
    interaction.preview(dashboard, Map.of("chart", spec));
    if (members.size() >= 24) throw Api.bad("Dashboard đã có tối đa 24 biểu đồ");
    var layout = new ArrayList<Map<String,Object>>();
    int bottom = 0;
    for (var member : members) {
      int pos = ((Number)member.get("position")).intValue();
      int y = coordinate(member, "grid_y", pos / 2 * 9);
      int h = coordinate(member, "grid_h", 9);
      layout.add(Map.of("chartId", member.get("chart_id").toString(), "x", coordinate(member, "grid_x", pos % 2 * 6),
          "y", y, "w", coordinate(member, "grid_w", 6), "h", h));
      bottom = Math.max(bottom, y + h);
    }
    if (bottom > 994) throw Api.bad("Dashboard không còn chỗ để thêm KPI");
    UUID chart = charts.save(spec, actor);
    layout.add(Map.of("chartId", chart.toString(), "x", 0, "y", bottom, "w", 6, "h", 6));
    dashboards.layout(dashboard, Map.of("items", layout), actor);
  }

  private static int coordinate(Map<String,Object> member, String key, int fallback) {
    return member.get(key) instanceof Number n ? n.intValue() : fallback;
  }
}
