package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.TextNode;

import java.sql.Types;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.regex.Pattern;

/** Recognizes explicit scalar questions independently of the AI plan. */
final class VerificationQuestion {
  private static final String BRANCH = "(?:chi nhanh|branch) ([A-Za-z0-9]+)";
  private static final String MONTH = "(?:thang|month) (\\d{1,2})(?: nam|/|-) ?(\\d{4})";
  private static final String SEPARATOR = "(?:(?: cua| trong| tai| vao| o| va| theo)*) ";
  private static final String SCOPE = "(" + BRANCH + "|" + MONTH + ")";
  private static final String SUFFIX = "(?: (?:la bao nhieu|bao nhieu))?";
  private static final Pattern METRIC = pattern("(?:hay |tinh |hay tinh |cho (?:toi|tui) biet )*"
      + "(tong(?: so)?|sum|trung binh|binh quan|average|avg|dem|count|so luong|so) (.+?)"
      + "(?:" + SEPARATOR + SCOPE + "(?:" + SEPARATOR + SCOPE + ")?)?" + SUFFIX);
  private static final Pattern BRANCH_ONLY = pattern(BRANCH);
  private static final Pattern MONTH_ONLY = pattern(MONTH);
  private static final Pattern KPI = pattern("(?:hay )?(?:them|gan|bo sung|tao them) (?:the )?kpi (.+?)"
      + "(?: (?:vao|cho|tren) (?:dashboard|bang dieu khien|bang tong quan)(?: vua tao| nay)?)?"
      + "(?: va loc(?: theo)? (" + BRANCH + "))?");
  private static final Pattern DASHBOARD = pattern("(?:hay )?(?:tao|lap|dung) (?:dashboard|bang dieu khien|bang tong quan)"
      + "(?: tong quan)? (?:doanh thu|revenue)(?:" + SEPARATOR + SCOPE + "(?:" + SEPARATOR + SCOPE + ")?)?");
  private static final Pattern FILTER = pattern("(?:hay )?loc(?: dashboard(?: vua tao| nay)?)?(?: theo)? (" + BRANCH + ")");

  record Metric(String aggregate, String column) {}
  record Expected(Metric metric, List<DatasetAnalysis.Filter> filters) {}
  record Kpi(Expected expected, boolean addsMetric) {}

  private final DatasetAnalysis.Metadata metadata;

  VerificationQuestion(DatasetAnalysis.Metadata metadata) {
    this.metadata = metadata;
  }

  Optional<Expected> query(String question) {
    var match = METRIC.matcher(fold(question));
    if (!match.matches()) return Optional.empty();
    String aggregate = switch (match.group(1).toLowerCase(Locale.ROOT)) {
      case "tong", "tong so", "sum" -> "sum";
      case "trung binh", "binh quan", "average", "avg" -> "avg";
      default -> "count";
    };
    String label = match.group(2).strip();
    if (label.matches("(?i)(?:don hang|orders)")) return Optional.empty();
    boolean rows = label.matches("(?i)(?:so )?(?:dong|ban ghi|rows|records)");
    if (rows && aggregate.equals("avg")) return Optional.empty();
    if (rows) aggregate = "count";
    String column = rows ? "*"
        : findColumn(label, aggregate).map(DatasetAnalysis.Column::name).orElse(null);
    if (column == null) return Optional.empty();
    Metric metric = new Metric(aggregate, column);
    return filters(match.group(3), match.group(7)).map(scope -> new Expected(metric, scope));
  }

  Optional<Expected> dashboard(String question) {
    var match = DASHBOARD.matcher(fold(question));
    if (!match.matches()) return Optional.empty();
    return filters(match.group(1), match.group(5)).map(scope -> new Expected(null, scope));
  }

  Optional<Kpi> dashboardUpdate(String question) {
    var match = KPI.matcher(fold(question));
    if (match.matches()) {
      var metric = query(match.group(1));
      var scope = filters(match.group(2), null);
      if (metric.isPresent() && metric.get().filters().isEmpty() && scope.isPresent())
        return Optional.of(new Kpi(new Expected(metric.get().metric(), scope.get()), true));
    }
    var filter = FILTER.matcher(fold(question));
    return filter.matches() ? filters(filter.group(1), null).map(scope -> new Kpi(new Expected(null, scope), false))
        : Optional.empty();
  }

  private Optional<List<DatasetAnalysis.Filter>> filters(String first, String second) {
    var filters = new ArrayList<DatasetAnalysis.Filter>();
    for (String condition : Arrays.asList(first, second)) {
      if (condition == null) continue;
      var branch = BRANCH_ONLY.matcher(condition);
      if (branch.matches()) {
        var column = findColumn("chi nhanh", null).filter(c -> c.kind().equals("text"));
        if (column.isEmpty() || filters.stream().anyMatch(f -> f.column().equals(column.get().name()))) return Optional.empty();
        filters.add(filter(column.get().name(), "eq", branch.group(1)));
        continue;
      }
      var month = MONTH_ONLY.matcher(condition);
      var dateColumns = metadata.columns().stream().filter(c -> c.kind().equals("date")).toList();
      if (!month.matches() || dateColumns.size() != 1 || filters.stream().anyMatch(f -> !f.operator().equals("eq")))
        return Optional.empty();
      var column = dateColumns.get(0);
      try {
        YearMonth period = YearMonth.of(Integer.parseInt(month.group(2)), Integer.parseInt(month.group(1)));
        if (period.getYear() < 1 || period.getYear() > 9998) return Optional.empty();
        filters.add(dateFilter(column, "gte", period.atDay(1)));
        filters.add(dateFilter(column, "lt", period.plusMonths(1).atDay(1)));
      } catch (java.time.DateTimeException e) {
        return Optional.empty();
      }
    }
    return Optional.of(List.copyOf(filters));
  }

  private Optional<DatasetAnalysis.Column> findColumn(String label, String aggregate) {
    String normalized = columnWords(label);
    var candidates = metadata.columns().stream()
        .filter(c -> aggregate == null || c.aggregates().contains(aggregate))
        .filter(c -> equivalentColumn(columnWords(c.name().replaceFirst("^c_", "")), normalized)
            || equivalentColumn(columnWords(c.label()), normalized))
        .toList();
    return candidates.size() == 1 ? Optional.of(candidates.get(0)) : Optional.empty();
  }

  private static boolean equivalentColumn(String column, String label) {
    return column.equals(label) || Set.of("doanh thu", "revenue").containsAll(List.of(column, label))
        || Set.of("chi nhanh", "branch").containsAll(List.of(column, label))
        || Set.of("chi phi", "cost").containsAll(List.of(column, label));
  }

  static DatasetAnalysis.Filter dateFilter(DatasetAnalysis.Column column, String operator, LocalDate date) {
    String value = date.toString();
    if (column.jdbcType() != Types.DATE)
      value += column.jdbcType() == Types.TIMESTAMP_WITH_TIMEZONE || column.type().equals("timestamptz") ? "T00:00:00Z" : "T00:00:00";
    return filter(column.name(), operator, value);
  }

  static DatasetAnalysis.Filter filter(String column, String operator, String value) {
    return new DatasetAnalysis.Filter(column, operator, TextNode.valueOf(value));
  }

  static DatasetAnalysis.Filter canonical(DatasetAnalysis.Filter filter, DatasetAnalysis.Metadata metadata) {
    var column = metadata.columns().stream().filter(c -> c.name().equals(filter.column())).findFirst().orElse(null);
    JsonNode value = filter.value();
    if (column == null || column.jdbcType() != Types.DATE || value == null || !value.isTextual()) return filter;
    try {
      LocalDate date = LocalDate.parse(value.asText());
      return switch (filter.operator()) {
        case "lte" -> dateFilter(column, "lt", date.plusDays(1));
        case "gt" -> dateFilter(column, "gte", date.plusDays(1));
        default -> filter;
      };
    } catch (java.time.DateTimeException e) {
      return filter;
    }
  }

  private static Pattern pattern(String expression) {
    return Pattern.compile(expression, Pattern.CASE_INSENSITIVE);
  }

  private static String columnWords(String text) {
    return fold(text).toLowerCase(Locale.ROOT).replaceFirst("^c_", "").replace('_', ' ');
  }

  private static String fold(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFD).replaceAll("\\p{M}+", "")
        .replace('đ', 'd').replace('Đ', 'D').replaceAll("\\s+", " ").strip().replaceAll("[?.!]+$", "").strip();
  }
}
