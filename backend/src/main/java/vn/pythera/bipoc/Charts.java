package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.sql.Types;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;

@Service
public class Charts {
  private final JdbcTemplate db;private final Datasets datasets;private final Queries queries;private final Auth auth;private final DatasetAnalysis analysis;private final ChartVisualization visualization;private final ObjectMapper mapper;
  Charts(JdbcTemplate db,Datasets datasets,Queries queries,Auth auth,DatasetAnalysis analysis,ChartVisualization visualization,ObjectMapper mapper){this.db=db;this.datasets=datasets;this.queries=queries;this.auth=auth;this.analysis=analysis;this.visualization=visualization;this.mapper=mapper;}
  public Map<String,Object> get(UUID id){
    List<Map<String,Object>> rows=db.queryForList("SELECT * FROM charts WHERE id=?",id);
    if(rows.isEmpty()) throw Api.notFound();return rows.get(0);
  }
  public List<Map<String,Object>> list(){
    return db.queryForList("""
        SELECT c.id,c.dataset_id,c.name,c.chart_type,c.dimension,c.metric,c.aggregate,c.time_grain,c.config_json,c.owner_id,c.created_at,
        d.name AS dataset_name FROM charts c JOIN datasets d ON d.id=c.dataset_id ORDER BY c.created_at DESC
        """);
  }
  public Map<String,Object> preview(Map<String,Object> spec,String filterValue){
    return preview(spec,filterValue,null,new Object[0]);
  }
  public Map<String,Object> preview(Map<String,Object> spec,String filterValue,String sourceOverride,Object[] sourceParams){
    String requestedType=Api.text(spec,"chartType").toLowerCase(Locale.ROOT);
    if(ChartVisualization.TYPES.contains(requestedType)){
      Map<String,Object> normalized=new LinkedHashMap<>(spec);normalized.put("chartType",requestedType);return visualization.preview(normalized,filterValue,sourceOverride,sourceParams);
    }
    if(requestedType.equals("donut")){
      Map<String,Object> pie=new LinkedHashMap<>(spec);pie.put("chartType","pie");
      Map<String,Object> result=new LinkedHashMap<>(preview(pie,filterValue,sourceOverride,sourceParams));result.put("chartType","donut");return result;
    }
    UUID datasetId=Api.uuid(Api.text(spec,"datasetId"));
    Map<String,Object> dataset=datasets.get(datasetId);
    String dimension=Api.text(spec,"dimension");String metric=Api.text(spec,"metric");
    String aggregate=Api.text(spec,"aggregate").toLowerCase(Locale.ROOT);
    String type=Api.text(spec,"chartType").toLowerCase(Locale.ROOT);
    if(!Set.of("sum","count","avg").contains(aggregate) || !Set.of("bar","line","pie").contains(type))
      throw Api.bad("Kiểu biểu đồ hoặc phép tổng hợp không hợp lệ");
    UUID connectionId=(UUID)dataset.get("connection_id");
    String source=sourceOverride==null?datasets.source(dataset):sourceOverride;
    List<DatasetAnalysis.Column> columns=analysis.metadata(datasetId).columns();
    DatasetAnalysis.Column dimensionColumn=columns.stream().filter(c->c.name().equals(dimension)).findFirst()
        .orElseThrow(()->Api.bad("Cột không nằm trong dataset"));
    if(!metric.equals("*")){
      DatasetAnalysis.Column metricColumn=columns.stream().filter(c->c.name().equals(metric)).findFirst()
          .orElseThrow(()->Api.bad("Cột không nằm trong dataset"));
      if(!aggregate.equals("count") && !metricColumn.kind().equals("number")) throw Api.bad("SUM/AVG cần chọn một cột số");
    }
    if(!aggregate.equals("count") && metric.equals("*")) throw Api.bad("SUM/AVG cần chọn một cột số");
    String dim=DashboardInteraction.quote(dimension);
    String grain=Api.optional(spec,"timeGrain");
    if(!grain.isEmpty() && !grain.equals("month")) throw Api.bad("Khoảng thời gian không hợp lệ");
    if(grain.equals("month") && !dimensionColumn.kind().equals("date")) throw Api.bad("Nhóm theo tháng cần cột ngày hoặc thời gian");
    String date=dim;
    if(dimensionColumn.jdbcType()==Types.TIMESTAMP_WITH_TIMEZONE || dimensionColumn.type().equals("timestamptz")) date+=" AT TIME ZONE 'UTC'";
    String group=grain.equals("month")?"to_char("+date+",'YYYY-MM')":dim;
    String expression=aggregate.toUpperCase(Locale.ROOT)+"("+(metric.equals("*")?"*":DashboardInteraction.quote(metric))+")";
    String sql="SELECT "+group+" AS label, "+expression+" AS value FROM "+source;
    Object[] params=sourceParams;
    if(filterValue!=null && !filterValue.isBlank()){
      sql+=" WHERE "+group+"::text = ?"; var combined=new ArrayList<Object>(Arrays.asList(sourceParams));combined.add(filterValue);params=combined.toArray();
    }
    if(grain.equals("month")) sql+=(filterValue==null || filterValue.isBlank()?" WHERE ":" AND ")+dim+" IS NOT NULL";
    sql+=" GROUP BY "+group+" ORDER BY "+group+" LIMIT 100";
    Map<String,Object> result=queries.run(connectionId,sql,params);
    Map<String,Object> response=new LinkedHashMap<>(Map.of("chartType",type,"dimension",dimension,"metric",metric,"aggregate",aggregate,
        "rows",result.get("rows"),"columns",result.get("columns")));
    response.put("timeGrain",grain.isEmpty()?null:grain);return response;
  }
  public UUID save(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);preview(body,null);
    UUID id=UUID.randomUUID();
    Map<String,Object> config=new LinkedHashMap<>();
    for(String key:ChartVisualization.OPTIONS)if(body.containsKey(key))config.put(key,body.get(key));
    String configJson;try{configJson=mapper.writeValueAsString(config);}catch(Exception e){throw Api.bad("Cấu hình biểu đồ không hợp lệ");}
    String chartType=Api.text(body,"chartType").toLowerCase(Locale.ROOT);
    String dimension=ChartVisualization.TYPES.contains(chartType)?Api.optional(body,"dimension"):Api.text(body,"dimension");
    String metric=ChartVisualization.TYPES.contains(chartType)?Api.optional(body,"metric"):Api.text(body,"metric");
    db.update("INSERT INTO charts(id,dataset_id,name,chart_type,dimension,metric,aggregate,owner_id,time_grain,config_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
        id,Api.uuid(Api.text(body,"datasetId")),Api.text(body,"name"),Api.text(body,"chartType").toLowerCase(Locale.ROOT),
        dimension,metric,Api.text(body,"aggregate").toLowerCase(Locale.ROOT),actor.id(),Api.optional(body,"timeGrain").isEmpty()?null:Api.optional(body,"timeGrain"),configJson);
    auth.audit(actor,"CREATE","CHART",id);return id;
  }
  public Map<String,Object> definition(UUID id){
    var c=get(id);
    Map<String,Object> spec=new LinkedHashMap<>(Map.of("datasetId",c.get("dataset_id").toString(),"dimension",c.get("dimension"),
        "metric",c.get("metric"),"aggregate",c.get("aggregate"),"chartType",c.get("chart_type")));
    try{var config=mapper.readTree(Objects.toString(c.get("config_json"),"{}"));for(String key:ChartVisualization.OPTIONS)if(config.has(key))spec.put(key,mapper.convertValue(config.get(key),Object.class));}
    catch(Exception e){throw Api.bad("Cấu hình biểu đồ đã lưu không hợp lệ");}
    spec.put("timeGrain",c.get("time_grain"));spec.put("id",id);spec.put("name",c.get("name"));return spec;
  }
  public void update(UUID id,Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);preview(body,null);
    Map<String,Object> config=new LinkedHashMap<>();for(String key:ChartVisualization.OPTIONS)if(body.containsKey(key))config.put(key,body.get(key));
    String json;try{json=mapper.writeValueAsString(config);}catch(Exception e){throw Api.bad("Cấu hình biểu đồ không hợp lệ");}
    if(db.update("UPDATE charts SET name=?,chart_type=?,dimension=?,metric=?,aggregate=?,time_grain=?,config_json=? WHERE id=?",
        Api.text(body,"name"),Api.text(body,"chartType").toLowerCase(Locale.ROOT),Api.optional(body,"dimension"),Api.optional(body,"metric"),
        Api.text(body,"aggregate").toLowerCase(Locale.ROOT),Api.optional(body,"timeGrain").isEmpty()?null:Api.optional(body,"timeGrain"),json,id)==0)throw Api.notFound();
    auth.audit(actor,"UPDATE","CHART",id);
  }
  public Map<String,Object> data(UUID id,String filter){
    var spec=definition(id);Map<String,Object> data=new LinkedHashMap<>(preview(spec,filter));
    data.put("id",id);data.put("name",spec.get("name"));return data;
  }

  @RestController @RequestMapping("/api/charts")
  public static class Controller {
    private final Charts service;private final Auth auth;private final JdbcTemplate db;
    Controller(Charts service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @GetMapping List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @PostMapping("/preview") Map<String,Object> preview(@RequestBody Map<String,Object> body,HttpServletRequest request){auth.actor(request);return service.preview(body,null);}
    @PostMapping Map<String,Object> save(@RequestBody Map<String,Object> body,HttpServletRequest request){return Map.of("id",service.save(body,auth.actor(request)));}
    @GetMapping("/{id}") Map<String,Object> definition(@PathVariable String id,HttpServletRequest request){auth.actor(request);return service.definition(Api.uuid(id));}
    @GetMapping("/{id}/data") Map<String,Object> data(@PathVariable String id,@RequestParam(required=false) String filter,HttpServletRequest request){auth.actor(request);return service.data(Api.uuid(id),filter);}
    @DeleteMapping("/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      int n=db.update("DELETE FROM charts WHERE id=?",Api.uuid(id));if(n==0) throw Api.notFound();
      auth.audit(actor,"DELETE","CHART",id);return Map.of("ok",true);
    }
  }
}
