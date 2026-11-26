package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ChatAnalysisPresentationTests {
  private final ObjectMapper mapper=new ObjectMapper();
  @SuppressWarnings("unchecked")
  private static List<Map<String,Object>> charts(Map<String,Object> result){return (List<Map<String,Object>>)result.get("charts");}
  @Test void nullSumAndZeroCountRemainDifferentKpis() throws Exception {
    Map<String,Object> row=new LinkedHashMap<>();row.put("revenue",null);row.put("orders",0L);
    var data=Map.<String,Object>of("rows",List.of(row));
    var config=mapper.readTree("{\"metrics\":[{\"column\":\"amount\",\"aggregate\":\"sum\",\"alias\":\"revenue\"},{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"orders\"}]}");
    var result=ChatAnalysisPresentation.query(UUID.randomUUID(),data,config);
    assertEquals("query",result.get("kind"));assertEquals(2,charts(result).size());
    assertTrue(charts(result).get(0).toString().contains("value=null"));
    assertTrue(charts(result).get(1).toString().contains("value=0"));
    assertFalse(result.containsKey("pValue"));assertFalse(result.containsKey("conclusion"));
  }
  @Test void timeGroupingUsesExecutedAliasesAndPreservesExactDecimals() throws Exception {
    var number=new BigDecimal("90071992547409931234567890.12");
    var data=Map.<String,Object>of("rows",List.of(Map.of("month","2025-01","revenue",number)),"truncated",true);
    var config=mapper.readTree("{\"groupBy\":[{\"column\":\"date\",\"timeGrain\":\"month\",\"alias\":\"month\"}],\"metrics\":[{\"column\":\"amount\",\"aggregate\":\"sum\",\"alias\":\"revenue\"}]}");
    var result=ChatAnalysisPresentation.query(UUID.randomUUID(),data,config);
    assertEquals("line",charts(result).get(0).get("chartType"));
    assertEquals(true,charts(result).get(0).get("truncated"));
    assertTrue(charts(result).get(0).toString().contains(number.toPlainString()));
    assertFalse(((List<?>)result.get("warnings")).isEmpty());
  }
  @Test void twoGroupsMakeStackedDataAndThreeGroupsStayTabular() throws Exception {
    var data=Map.<String,Object>of("rows",List.of(Map.of("region","N","category","A","n",2)));
    var config=mapper.readTree("{\"groupBy\":[{\"column\":\"region\"},{\"column\":\"category\"}],\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"n\"}]}");
    assertEquals("stacked-bar",charts(ChatAnalysisPresentation.query(UUID.randomUUID(),data,config)).get(0).get("chartType"));
    ((com.fasterxml.jackson.databind.node.ArrayNode)config.get("groupBy")).add(mapper.readTree("{\"column\":\"third\"}"));
    assertTrue(charts(ChatAnalysisPresentation.query(UUID.randomUUID(),data,config)).isEmpty());
  }
  @Test void emptyQueryDoesNotInventAStatisticalFailure() throws Exception {
    var result=ChatAnalysisPresentation.query(UUID.randomUUID(),Map.of("rows",List.of()),mapper.readTree("{\"metrics\":[]}"));
    assertEquals("success",result.get("status"));assertTrue(charts(result).isEmpty());
  }
  @Test void ungroupedSummaryIncludesEachComputedMetric() throws Exception {
    var config=mapper.readTree("""
        {"groupBy":[],"metrics":[{"aggregate":"count_invalid","alias":"invalid"},{"aggregate":"avg","alias":"average"}]}
        """);
    var data=Map.<String,Object>of("rows",List.of(Map.of("invalid",0,"average",345)),
        "metricLabels",Map.of("invalid","Số ô sai kiểu","average","Trung bình doanh thu"));
    assertFalse(ChatAnalysisPresentation.isQualityQuery(config));
    assertEquals("Số ô sai kiểu là 0. Trung bình doanh thu là 345.",
        ChatAnalysisPresentation.totalsSummary(data,config).orElseThrow());
  }
  @Test void recoversBranchFocusWithoutAssumingAUniqueLowestBranch() throws Exception {
    var ranked=mapper.readTree("""
        {"status":"success","data":{"rows":[{"Chi nhánh":"B","Tổng doanh thu":26580},
        {"Chi nhánh":"A","Tổng doanh thu":26880}]}}
        """);
    assertEquals("B",ChatAnalysisPresentation.branchFocus(ranked).orElseThrow());
    assertTrue(ChatAnalysisPresentation.branchFocus(mapper.readTree(ranked.toString().replace("26880","26580"))).isEmpty());
    var explicit=mapper.readTree("""
        {"status":"success","branchComparison":{"branch":"A","referenceBranch":"B","delta":300}}
        """);
    assertEquals("A",ChatAnalysisPresentation.branchFocus(explicit).orElseThrow());
  }
}
