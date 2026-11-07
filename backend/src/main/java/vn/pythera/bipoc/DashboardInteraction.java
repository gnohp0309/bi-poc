package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.util.*;
import java.time.LocalDate;

/** Dashboard predicates are scoped to a dataset and bound before any aggregation. */
@Service
public class DashboardInteraction {
  private final JdbcTemplate db; private final Charts charts; private final Datasets datasets;
  private final DatasetAnalysis analysis; private final Queries queries;
  DashboardInteraction(JdbcTemplate db,Charts charts,Datasets datasets,DatasetAnalysis analysis,Queries queries){this.db=db;this.charts=charts;this.datasets=datasets;this.analysis=analysis;this.queries=queries;}
  record Source(String sql,Object[] params) {}
  static String quote(String value){return "\""+value.replace("\"","\"\"")+"\"";}
  List<Map<String,Object>> members(UUID id){
    if(db.queryForList("SELECT id FROM dashboards WHERE id=?",id).isEmpty())throw Api.notFound();
    return db.queryForList("SELECT * FROM dashboard_charts WHERE dashboard_id=? ORDER BY position",id);
  }
  public Map<String,Object> metadata(UUID id){
    Set<UUID> ids=new LinkedHashSet<>();for(var item:members(id))ids.add(Api.uuid(charts.definition((UUID)item.get("chart_id")).get("datasetId").toString()));
    var result=new ArrayList<Map<String,Object>>();
    for(UUID datasetId:ids){var d=datasets.get(datasetId);var columns=new ArrayList<Map<String,String>>();
      for(var c:analysis.metadata(datasetId).columns())if(!c.kind().equals("other"))columns.add(Map.of("name",c.name(),"kind",c.kind()));
      result.add(Map.of("id",datasetId,"name",d.get("name"),"columns",columns));}
    return Map.of("datasets",result);
  }
  @SuppressWarnings("unchecked")
  List<Map<String,Object>> filters(Map<String,Object> body){
    Object raw=body.getOrDefault("filters",List.of());
    if(!(raw instanceof List<?> list) || list.size()>12)throw Api.bad("Tối đa 12 bộ lọc");
    var result=new ArrayList<Map<String,Object>>();
    for(Object value:list){if(!(value instanceof Map<?,?>))throw Api.bad("Bộ lọc không hợp lệ");result.add((Map<String,Object>)value);}
    return result;
  }
  Source source(UUID datasetId,List<Map<String,Object>> filters){
    var cols=new HashMap<String,DatasetAnalysis.Column>();analysis.metadata(datasetId).columns().forEach(c->cols.put(c.name(),c));
    var where=new ArrayList<String>();var params=new ArrayList<Object>();
    for(var f:filters){
      if(!datasetId.equals(Api.uuid(Api.text(f,"datasetId"))))continue;
      String name=Api.text(f,"column"),op=Api.text(f,"op");var c=cols.get(name);
      if(c==null || c.kind().equals("other"))throw Api.bad("Cột lọc không hợp lệ: "+name);
      String q=quote(name);
      switch(op){
        case "eq" -> {String value=Api.text(f,"value");if(value.length()>1000)throw Api.bad("Giá trị lọc quá dài");where.add(q+"::text = ?");params.add(value);}
        case "null" -> where.add(q+" IS NULL");
        case "date" -> {
          if(!c.kind().equals("date"))throw Api.bad("Khoảng thời gian cần cột ngày");
          LocalDate start,end;try{start=LocalDate.parse(Api.text(f,"value"));end=LocalDate.parse(Api.text(f,"end"));}catch(Exception e){throw Api.bad("Ngày phải theo YYYY-MM-DD");}
          if(end.isBefore(start) || end.getYear()>9998)throw Api.bad("Khoảng ngày không hợp lệ");
          if(c.type().equals("timestamptz"))q+=" AT TIME ZONE 'UTC'";
          where.add("("+q+") >= CAST(? AS date) AND ("+q+") < CAST(? AS date)");params.add(start.toString());params.add(end.plusDays(1).toString());
        }
        default -> throw Api.bad("Phép lọc không hợp lệ");
      }
    }
    return new Source("(SELECT * FROM "+datasets.source(datasets.get(datasetId))+(where.isEmpty()?"":" WHERE "+String.join(" AND ",where))+") dashboard_filtered",params.toArray());
  }
  void validateScope(List<Map<String,Object>> filters,List<Map<String,Object>> members){
    Set<String> ids=new HashSet<>();for(var m:members)ids.add(charts.definition((UUID)m.get("chart_id")).get("datasetId").toString());
    for(var f:filters)if(!ids.contains(Api.text(f,"datasetId")))throw Api.bad("Dataset lọc không thuộc dashboard");
  }
  public Map<String,Object> query(UUID id,Map<String,Object> body){
    var members=members(id);var filters=filters(body);validateScope(filters,members);
    var rows=new ArrayList<Map<String,Object>>();
    for(var m:members){UUID chartId=(UUID)m.get("chart_id");var spec=charts.definition(chartId);UUID datasetId=Api.uuid(spec.get("datasetId").toString());var source=source(datasetId,filters);
      var chart=new LinkedHashMap<>(charts.preview(spec,null,source.sql(),source.params()));chart.put("id",chartId);chart.put("name",spec.get("name"));chart.put("datasetId",datasetId);
      @SuppressWarnings("unchecked") var points=(List<Map<String,Object>>)chart.get("rows");chart.put("rowKeys",points.stream().map(DashboardInteraction::key).toList());
      int pos=((Number)m.get("position")).intValue();chart.put("position",pos);
      chart.put("x",Objects.requireNonNullElse(m.get("grid_x"),(pos%2)*6));chart.put("y",Objects.requireNonNullElse(m.get("grid_y"),(pos/2)*9));chart.put("w",Objects.requireNonNullElse(m.get("grid_w"),6));chart.put("h",Objects.requireNonNullElse(m.get("grid_h"),9));rows.add(chart);
    }
    var result=new LinkedHashMap<>(db.queryForMap("SELECT id,name,share_token FROM dashboards WHERE id=?",id));result.put("charts",rows);result.put("refreshedAt",java.time.Instant.now().toString());return result;
  }
  @SuppressWarnings("unchecked")
  public Map<String,Object> drill(UUID id,UUID chartId,Map<String,Object> body){
    var members=members(id);if(members.stream().noneMatch(m->chartId.equals(m.get("chart_id"))))throw Api.notFound();
    var filters=filters(body);validateScope(filters,members);var spec=charts.definition(chartId);UUID datasetId=Api.uuid(spec.get("datasetId").toString());var source=source(datasetId,filters);
    var rendered=charts.preview(spec,null,source.sql(),source.params());var rows=(List<Map<String,Object>>)rendered.get("rows");
    var conditions=new ArrayList<String>();var params=new ArrayList<Object>(Arrays.asList(source.params()));
    String type=spec.get("chartType").toString();
    if(!type.equals("kpi")){
      int index;try{index=new java.math.BigDecimal(Objects.toString(body.get("rowIndex"),"")).intValueExact();}catch(Exception e){throw Api.bad("Chọn một điểm dữ liệu hợp lệ");}
      if(index<0 || index>=rows.size())throw Api.bad("Điểm dữ liệu đã thay đổi; hãy làm mới dashboard");var row=rows.get(index);if(!key(row).equals(Api.text(body,"rowKey")))throw Api.bad("Dữ liệu đã thay đổi; hãy làm mới dashboard rồi chọn lại điểm");
      String dim=Api.optional(spec,"dimension"),metric=Api.optional(spec,"metric");
      switch(type){
        case "histogram" -> {String q=quote(metric);conditions.add(q+" >= ? AND "+q+(index==rows.size()-1?" <= ?":" < ?"));params.add(row.get("lower_bound"));params.add(row.get("upper_bound"));}
        case "scatter" -> {equal(conditions,params,quote(dim),row.get("x"));equal(conditions,params,quote(metric),row.get("y"));}
        case "map" -> {equal(conditions,params,quote(Api.text(spec,"longitude")),row.get("x"));equal(conditions,params,quote(Api.text(spec,"latitude")),row.get("y"));String label=Api.optional(spec,"labelColumn");if(!label.isEmpty())equal(conditions,params,quote(label)+"::text",row.get("label"));}
        case "heatmap" -> {conditions.add(finite(quote(row.get("x").toString()))+" AND "+finite(quote(row.get("y").toString())));}
        default -> {String expression=quote(dim);if("month".equals(Api.optional(spec,"timeGrain"))){var col=analysis.metadata(datasetId).columns().stream().filter(c->c.name().equals(dim)).findFirst().orElseThrow();if(col.type().equals("timestamptz"))expression+=" AT TIME ZONE 'UTC'";expression="to_char("+expression+",'YYYY-MM')";}equal(conditions,params,expression,row.get("label"));if(type.startsWith("stacked-"))equal(conditions,params,quote(Api.text(spec,"seriesDimension")),row.get("series"));}
      }
    }
    String metric=Api.optional(spec,"metric");
    if(!metric.isEmpty() && !metric.equals("*") && !type.equals("heatmap")){
      conditions.add(quote(metric)+" IS NOT NULL");
      if(!"count".equals(Api.optional(spec,"aggregate")) && Set.of("kpi","map","stacked-bar","stacked-area").contains(type))conditions.add(finite(quote(metric)));
    }
    if(type.equals("map")) {conditions.add(finite(quote(Api.text(spec,"latitude"))));conditions.add(finite(quote(Api.text(spec,"longitude"))));}
    var result=new LinkedHashMap<>(queries.run((UUID)datasets.get(datasetId).get("connection_id"),"SELECT * FROM "+source.sql()+(conditions.isEmpty()?"":" WHERE "+String.join(" AND ",conditions)),params.toArray()));
    result.put("note","Tối đa 500 dòng, thứ tự nguồn. Truy vấn lại dữ liệu hiện tại; dữ liệu nguồn thay đổi có thể làm kết quả khác biểu đồ trước đó.");return result;
  }
  static String finite(String q){return q+" IS NOT NULL AND "+q+"::text NOT IN ('NaN','Infinity','-Infinity')";}
  static String key(Map<String,Object> row){return UUID.nameUUIDFromBytes(row.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();}
  static void equal(List<String> where,List<Object> params,String expression,Object value){if(value==null)where.add(expression+" IS NULL");else{where.add("("+expression+") IS NOT DISTINCT FROM ?");params.add(value);}}
  @RestController @RequestMapping("/api/dashboards/{id}")
  static class Controller {
    final DashboardInteraction service;final Auth auth;Controller(DashboardInteraction service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping("/filters") Map<String,Object> metadata(@PathVariable String id,HttpServletRequest req){auth.actor(req);return service.metadata(Api.uuid(id));}
    @PostMapping("/query") Map<String,Object> query(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req){auth.actor(req);return service.query(Api.uuid(id),body);}
    @PostMapping("/charts/{chartId}/drill") Map<String,Object> drill(@PathVariable String id,@PathVariable String chartId,@RequestBody Map<String,Object> body,HttpServletRequest req){auth.actor(req);return service.drill(Api.uuid(id),Api.uuid(chartId),body);}
  }
}
