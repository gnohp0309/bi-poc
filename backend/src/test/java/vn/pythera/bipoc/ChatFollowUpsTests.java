package vn.pythera.bipoc;

import org.junit.jupiter.api.Test;

import java.sql.Types;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

class ChatFollowUpsTests {
  private static final String VALUE = "net_amount";
  private static final String BRANCH = "office";
  private static final String DATE = "sold_on";
  private static final String STATUS = "order_status";
  private final VerificationQuestion parser = new VerificationQuestion(new DatasetAnalysis.Metadata(
      UUID.randomUUID(),"Sales","PHYSICAL",List.of(
      new DatasetAnalysis.Column(VALUE,"Doanh thu","numeric","number",true,List.of("sum","avg","count"),List.of(),Types.NUMERIC),
      new DatasetAnalysis.Column(BRANCH,"Chi nhánh","text","text",true,List.of("count"),List.of(),Types.VARCHAR),
      new DatasetAnalysis.Column(DATE,"Ngày bán","date","date",true,List.of("count"),List.of("month"),Types.DATE),
      new DatasetAnalysis.Column(STATUS,"Trạng thái","text","text",true,List.of("count"),List.of(),Types.VARCHAR)
  ),Map.of()));
  private final ChatFollowUps followUps = new ChatFollowUps(parser);

  @Test void relativeTimeReplacesOnlyTheMonthOnTheRenamedDataset() {
    var original = parser.query("Tổng doanh thu trạng thái Completed chi nhánh A tháng 1/2025 là bao nhiêu?").orElseThrow();
    var changed = followUps.resolve("con thang truoc thi sao", original).orElseThrow().scope();
    assertEquals(new VerificationQuestion.Metric("sum", VALUE), changed.metric());
    assertEquals(List.of(VerificationQuestion.filter(STATUS,"eq","Completed"), VerificationQuestion.filter(BRANCH,"eq","A"),
        VerificationQuestion.filter(DATE,"gte","2024-12-01"), VerificationQuestion.filter(DATE,"lt","2025-01-01")),
        changed.filters());
    var year = followUps.suggestionScope("previous-year", original);
    assertTrue(year.filters().contains(VerificationQuestion.filter(DATE,"gte","2024-01-01")));
    assertEquals(3, followUps.suggestions(original).size());
  }

  @Test void branchChangeAndAllBranchesLeaveTheOtherFiltersInPlace() {
    var original = parser.query("Trung bình doanh thu tháng 3 năm 2025 của chi nhánh A và trạng thái Pending.").orElseThrow();
    var changed = followUps.resolve("Còn chi nhánh B?", original).orElseThrow().scope();
    assertTrue(changed.filters().contains(VerificationQuestion.filter(BRANCH,"eq","B")));
    var across = followUps.suggestionScope("all-branches", changed);
    assertEquals(original.metric(), across.metric());
    assertEquals(original.filters().stream().filter(f -> !BRANCH.equals(f.column())).toList(), across.filters());
    assertThrows(Api.Failure.class, () -> followUps.suggestionScope("all-branches", across));
  }

  @Test void unknownOrAmbiguousScopeDoesNotTurnIntoAnUnfilteredQuery() {
    var whole = parser.query("Tổng doanh thu của toàn bộ dữ liệu?").orElseThrow();
    assertTrue(whole.filters().isEmpty());
    assertNull(followUps.resolve("Còn tháng trước thì sao?", whole).orElseThrow().scope());
    assertNull(followUps.resolve("Còn cùng kỳ?", whole).orElseThrow().scope());
    assertNull(followUps.resolve("Còn tháng 13/2025?", whole).orElseThrow().scope());
    assertNull(followUps.resolve("Còn chi nhánh B?", null).orElseThrow().scope());
    assertTrue(parser.query("Tổng doanh thu chi nhánh A toàn bộ dữ liệu").isEmpty());
    assertTrue(parser.query("Tổng doanh thu chi nhánh A tháng 3/2025 trừ danh mục Store").isEmpty());
  }
}
