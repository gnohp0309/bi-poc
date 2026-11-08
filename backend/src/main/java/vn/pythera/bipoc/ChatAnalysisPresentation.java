package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.*;

/** Presentation only: use executed rows, never model-generated numerical results. */
final class ChatAnalysisPresentation {
  private ChatAnalysisPresentation() {}
  static Map<String,Object> query(UUID datasetId,Map<String,Object> data,JsonNode config) {
    @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)data.get("rows");
    boolean truncated=Boolean.TRUE.equals(data.get("truncated"));
    Map<String,Object> result=new LinkedHashMap<>();
    result.put("schemaVersion",1);result.put("kind","query");result.put("status","success");
    result.put("title","Kết quả phân tích dữ liệu");
    result.put("summary",rows.isEmpty()?"Không có dòng kết quả phù hợp.":"Đã nhận "+rows.size()+" dòng kết quả"+(truncated?" (đã giới hạn).":"."));
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
  private static String groupAlias(JsonNode group){return group.hasNonNull("alias")?group.path("alias").asText():group.path("column").asText();}
}
