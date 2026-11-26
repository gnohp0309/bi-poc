package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.JsonNode;
import java.text.NumberFormat;
import java.util.*;

/** Presentation only: use executed rows, never model-generated numerical results. */
final class ChatAnalysisPresentation {
  private ChatAnalysisPresentation() {}
  static Optional<String> branchFocus(JsonNode report) {
    if(!"success".equals(report.path("status").asText())) return Optional.empty();
    JsonNode focus=report.path("branchComparison").path("branch");
    if(!focus.isTextual() && !report.has("branchComparison")) {
      JsonNode rows=report.path("data").path("rows");
      JsonNode first=rows.path(0).path("Tổng doanh thu");
      JsonNode second=rows.path(1).path("Tổng doanh thu");
      if(first.isNumber() && second.isNumber() && first.decimalValue().compareTo(second.decimalValue()) < 0)
        focus=rows.path(0).path("Chi nhánh");
    }
    return focus.isTextual() && !focus.asText().isBlank() && focus.asText().length()<=500
        ?Optional.of(focus.asText()):Optional.empty();
  }
  static Map<String,Object> query(UUID datasetId,Map<String,Object> data,JsonNode config) {
    @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)data.get("rows");
    boolean truncated=Boolean.TRUE.equals(data.get("truncated"));
    Map<String,Object> result=new LinkedHashMap<>();
    result.put("schemaVersion",1);result.put("kind","query");result.put("status","success");
    result.put("title","Kết quả phân tích dữ liệu");
    result.put("summary",rows.isEmpty()?"Không có dòng kết quả phù hợp.":"Đã nhận "+rows.size()+" dòng kết quả"+(truncated?" (đã giới hạn).":"."));
    if(data.get("method") instanceof String method) result.put("method",method);
    result.put("datasetId",datasetId);result.put("data",data);
    result.put("provenance",Map.of("engine","PostgreSQL","sampled",false,"scope","dataset-definition","queryConfig",config));
    List<String> warnings=new ArrayList<>();
    if(truncated)warnings.add("Kết quả đã giới hạn số dòng/nhóm; không coi tổng phần hiển thị là tổng toàn bộ dataset.");
    result.put("warnings",warnings);
    List<Map<String,Object>> visualizations=new ArrayList<>();
    JsonNode groups=config.path("groupBy"),metrics=config.path("metrics");
    int groupCount=groups.isArray()?groups.size():0;
    if(!rows.isEmpty() && metrics.isArray() && groupCount<=2) {
      for(JsonNode metric:metrics) {
        String alias=metric.path("alias").asText(),column=metric.path("column").asText();
        if(alias.isBlank() || rows.stream().anyMatch(r->r.get(alias)!=null && !(r.get(alias) instanceof Number)))continue;
        String dimension=groupCount>0?groupAlias(groups.get(0)):"";
        String series=groupCount==2?groupAlias(groups.get(1)):"";
        String type=groupCount==0?"kpi":groupCount==2?"stacked-bar":groups.get(0).hasNonNull("timeGrain")?"line":"bar";
        Map<String,Object> chart=new LinkedHashMap<>();
        chart.put("chartType",type);chart.put("name",alias);chart.put("metric",column);chart.put("dimension",dimension);
        chart.put("aggregate",metric.path("aggregate").asText());chart.put("truncated",truncated);
        List<Map<String,Object>> points=new ArrayList<>();
        for(var row:rows) {
          Map<String,Object> point=new LinkedHashMap<>();point.put("value",row.get(alias));
          if(groupCount>0)point.put("label",row.get(dimension));
          if(groupCount==2)point.put("series",row.get(series));points.add(point);
        }
        chart.put("rows",points);visualizations.add(chart);
      }
    }
    result.put("charts",visualizations);
    return result;
  }
  static boolean isQualityQuery(JsonNode config) {
    if(config==null || config.path("metrics").isEmpty()) return false;
    for(JsonNode metric:config.path("metrics"))
      if(!DatasetAnalysis.QUALITY_AGGREGATES.contains(metric.path("aggregate").asText())) return false;
    return true;
  }
  static Optional<String> totalsSummary(Map<String,Object> data,JsonNode config){
    @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)data.get("rows");
    if(rows.size()!=1 || !config.path("groupBy").isEmpty() || !(data.get("metricLabels") instanceof Map<?,?> labels))
      return Optional.empty();
    NumberFormat numbers=NumberFormat.getNumberInstance(Locale.forLanguageTag("vi-VN"));
    numbers.setMaximumFractionDigits(12);
    var sentences=new ArrayList<String>();
    for(JsonNode metric:config.path("metrics")) {
      String alias=metric.path("alias").asText();
      Object value=rows.get(0).get(alias);
      String label=Objects.toString(labels.get(alias),alias);
      sentences.add(label+(value instanceof Number n?" là "+numbers.format(n)+".":" chưa có giá trị trong phạm vi này."));
    }
    return sentences.isEmpty()?Optional.empty():Optional.of(String.join(" ",sentences));
  }
  static String qualitySummary(Map<String,Object> data,JsonNode config){
    @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)data.get("rows");
    if(rows.isEmpty()) return "Không có dòng phù hợp để kiểm tra chất lượng dữ liệu.";
    if(Boolean.TRUE.equals(data.get("truncated")))
      return "Bảng chỉ hiển thị một phần kết quả theo nhóm, chưa đủ để tính tổng số ô trống hoặc sai kiểu.";
    var totals=new ArrayList<String>();
    for(JsonNode metric:config.path("metrics")){
      String aggregate=metric.path("aggregate").asText();
      if(!DatasetAnalysis.QUALITY_AGGREGATES.contains(aggregate)) continue;
      String alias=metric.path("alias").asText();
      long total=rows.stream().mapToLong(row->((Number)row.get(alias)).longValue()).sum();
      totals.add(total+(aggregate.equals("count_blank")?" ô trống":" ô sai kiểu"));
    }
    String detail=config.path("groupBy").isEmpty()?".":". Bảng bên dưới cho biết số lượng ở từng nhóm.";
    return "Trong phạm vi đã chọn, có "+String.join(" và ",totals)+detail;
  }
  private static String groupAlias(JsonNode group){return group.hasNonNull("alias")?group.path("alias").asText():group.path("column").asText();}
}
