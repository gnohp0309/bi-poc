package vn.pythera.bipoc;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.regex.Pattern;

/** Resolve scalar follow-ups against a prior scope chosen by the application. */
final class ChatFollowUps {
  private static final String PREVIOUS_MONTH = "thang (?:truoc|lien truoc)";
  private static final String LAST_YEAR = "(?:cung ky nam truoc|cung thang nam truoc)";
  private static final String ALL_BRANCHES = "(?:toan bo|tat ca)(?: cac)? chi nhanh";
  private static final Pattern RELATIVE = Pattern.compile("(?:con |doi sang |xem |chuyen sang )?("
      + PREVIOUS_MONTH + "|" + LAST_YEAR + "|" + ALL_BRANCHES + "|cung ky|" + VerificationQuestion.MONTH
      + "|thang (\\d{1,2})|" + VerificationQuestion.BRANCH + ")(?: thi sao| thi the nao)?", Pattern.CASE_INSENSITIVE);
  private static final Pattern SHORT_MONTH = Pattern.compile("thang (\\d{1,2})", Pattern.CASE_INSENSITIVE);
  private static final Pattern BRANCH = Pattern.compile(VerificationQuestion.BRANCH, Pattern.CASE_INSENSITIVE);

  record Resolution(VerificationQuestion.Expected scope, String clarification) {}
  record Suggestion(String id, String label) {}

  private final VerificationQuestion parser;

  ChatFollowUps(VerificationQuestion parser) { this.parser = parser; }

  Optional<Resolution> resolve(String question, VerificationQuestion.Expected prior) {
    var relative = RELATIVE.matcher(VerificationQuestion.fold(question));
    if (!relative.matches()) return Optional.empty();
    String phrase = relative.group(1);
    String lower = phrase.toLowerCase(Locale.ROOT);
    if (lower.equals("cung ky"))
      return clarify("Bạn muốn xem tháng liền trước hay cùng tháng năm trước?");
    if (prior == null)
      return clarify("Bạn muốn tính chỉ số nào và cho kỳ hoặc chi nhánh nào? Ví dụ: Tổng doanh thu chi nhánh A tháng 3/2025.");

    var branch = BRANCH.matcher(phrase);
    if (branch.matches() || lower.matches(ALL_BRANCHES)) {
      var column = parser.branchColumn();
      if (column.isEmpty()) return clarify("Bạn muốn dùng cột nào làm chi nhánh?");
      List<DatasetAnalysis.Filter> replacement = lower.matches(ALL_BRANCHES) ? List.of()
          : List.of(VerificationQuestion.filter(column.get().name(), "eq", branch.group(1)));
      return resolved(replace(prior, column.get().name(), replacement));
    }

    var date = parser.dateColumn();
    if (date.isEmpty()) return clarify("Bạn muốn dùng cột nào làm ngày?");
    var explicit = VerificationQuestion.MONTH_ONLY.matcher(phrase);
    var shortMonth = SHORT_MONTH.matcher(phrase);
    try {
      YearMonth month;
      if (explicit.matches()) {
        month = YearMonth.of(Integer.parseInt(explicit.group(2)), Integer.parseInt(explicit.group(1)));
      } else {
        var anchor = month(prior, date.get());
        if (anchor.isEmpty())
          return clarify("Bạn muốn lấy tháng nào làm mốc? Hãy ghi cả tháng và năm.");
        month = shortMonth.matches() ? anchor.get().withMonth(Integer.parseInt(shortMonth.group(1)))
            : lower.matches(PREVIOUS_MONTH) ? anchor.get().minusMonths(1) : anchor.get().minusYears(1);
      }
      if (month.getYear() < 1 || month.getYear() > 9998) throw new DateTimeException("Year outside supported range");
      return resolved(replace(prior, date.get().name(), VerificationQuestion.monthFilters(date.get(), month)));
    } catch (DateTimeException e) {
      return clarify("Tháng hoặc năm chưa hợp lệ. Bạn hãy nhập lại, ví dụ tháng 3/2025.");
    }
  }

  List<Suggestion> suggestions(VerificationQuestion.Expected scope) {
    var suggestions = new ArrayList<Suggestion>(3);
    parser.dateColumn().flatMap(date -> month(scope, date)).ifPresent(month -> {
      if (month.getYear() > 1 || month.getMonthValue() > 1)
        suggestions.add(new Suggestion("previous-month", "Xem tháng liền trước"));
      if (month.getYear() > 1)
        suggestions.add(new Suggestion("previous-year", "Xem cùng tháng năm trước"));
    });
    parser.branchColumn().filter(branch -> scope.filters().stream().anyMatch(f -> f.column().equals(branch.name())))
        .ifPresent(branch -> suggestions.add(new Suggestion("all-branches", "Xem toàn bộ chi nhánh")));
    return List.copyOf(suggestions);
  }

  VerificationQuestion.Expected suggestionScope(String id, VerificationQuestion.Expected prior) {
    if (suggestions(prior).stream().noneMatch(s -> s.id().equals(id))) throw Api.notFound();
    String phrase = switch (id) {
      case "previous-month" -> "tháng liền trước";
      case "previous-year" -> "cùng tháng năm trước";
      case "all-branches" -> "toàn bộ chi nhánh";
      default -> throw Api.notFound();
    };
    return resolve(phrase, prior).orElseThrow().scope();
  }

  private static Optional<YearMonth> month(VerificationQuestion.Expected scope, DatasetAnalysis.Column date) {
    var filters = scope.filters().stream().filter(f -> f.column().equals(date.name())).toList();
    if (filters.size() != 2) return Optional.empty();
    var start = filters.stream().filter(f -> f.operator().equals("gte") && f.value() != null && f.value().isTextual()).findFirst();
    if (start.isEmpty()) return Optional.empty();
    String value = start.get().value().asText();
    if (value.length() < 10) return Optional.empty();
    try {
      var month = YearMonth.from(LocalDate.parse(value.substring(0, 10)));
      return filters.containsAll(VerificationQuestion.monthFilters(date, month)) ? Optional.of(month) : Optional.empty();
    } catch (DateTimeException e) {
      return Optional.empty();
    }
  }

  private static VerificationQuestion.Expected replace(VerificationQuestion.Expected prior, String column,
                                                        List<DatasetAnalysis.Filter> replacement) {
    var filters = new ArrayList<>(prior.filters().stream().filter(f -> !f.column().equals(column)).toList());
    filters.addAll(replacement);
    return new VerificationQuestion.Expected(prior.metric(), List.copyOf(filters));
  }

  private static Optional<Resolution> resolved(VerificationQuestion.Expected scope) {
    return Optional.of(new Resolution(scope, null));
  }

  private static Optional<Resolution> clarify(String question) { return Optional.of(new Resolution(null, question)); }
}
