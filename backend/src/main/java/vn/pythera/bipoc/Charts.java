package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@Service
public class Charts {
  private final JdbcTemplate db;private final Datasets datasets;private final Queries queries;private final Auth auth;
  Charts(JdbcTemplate db,Datasets datasets,Queries queries,Auth auth){this.db=db;this.datasets=datasets;this.queries=queries;this.auth=auth;}
  public Map<String,Object> get(UUID id){
    List<Map<String,Object>> rows=db.queryForList("SELECT * FROM charts WHERE id=?",id);
    if(rows.isEmpty()) throw Api.notFound();return rows.get(0);
  }
  public List<Map<String,Object>> list(){
    return db.queryForList("""
        SELECT c.id,c.dataset_id,c.name,c.chart_type,c.dimension,c.metric,c.aggregate,c.owner_id,c.created_at,
        d.name AS dataset_name FROM charts c JOIN datasets d ON d.id=c.dataset_id ORDER BY c.created_at DESC
        """);
  }
  public Map<String,Object> preview(Map<String,Object> spec,String filterValue){
    UUID datasetId=Api.uuid(Api.text(spec,"datasetId"));
    Map<String,Object> dataset=datasets.get(datasetId);
    String dimension=Api.text(spec,"dimension");String metric=Api.text(spec,"metric");
    String aggregate=Api.text(spec,"aggregate").toLowerCase(Locale.ROOT);
    String type=Api.text(spec,"chartType").toLowerCase(Locale.ROOT);
    if(!Set.of("sum","count","avg").contains(aggregate) || !Set.of("bar","line","pie").contains(type))
      throw Api.bad("Kiểu biểu đồ hoặc phép tổng hợp không hợp lệ");
    UUID connectionId=(UUID)dataset.get("connection_id");
    String source=datasets.source(dataset);
    @SuppressWarnings("unchecked")
    List<String> columns=(List<String>)queries.run(connectionId,"SELECT * FROM "+source+" LIMIT 0").get("columns");
    if(!columns.contains(dimension) || (!metric.equals("*") && !columns.contains(metric))) throw Api.bad("Cột không nằm trong dataset");
    if(!aggregate.equals("count") && metric.equals("*")) throw Api.bad("SUM/AVG cần chọn một cột số");
    String dim=Queries.identifier(dimension);
    String expression=aggregate.toUpperCase(Locale.ROOT)+"("+(metric.equals("*")?"*":Queries.identifier(metric))+")";
    String sql="SELECT "+dim+" AS label, "+expression+" AS value FROM "+source;
    Object[] params=new Object[0];
    if(filterValue!=null && !filterValue.isBlank()){
      sql+=" WHERE "+dim+"::text = ?"; params=new Object[]{filterValue};
    }
    sql+=" GROUP BY "+dim+" ORDER BY "+dim+" LIMIT 100";
    Map<String,Object> result=queries.run(connectionId,sql,params);
    return Map.of("chartType",type,"dimension",dimension,"metric",metric,"aggregate",aggregate,
        "rows",result.get("rows"),"columns",result.get("columns"));
  }
  public UUID save(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);preview(body,null);
    UUID id=UUID.randomUUID();
    db.update("INSERT INTO charts(id,dataset_id,name,chart_type,dimension,metric,aggregate,owner_id) VALUES (?,?,?,?,?,?,?,?)",
        id,Api.uuid(Api.text(body,"datasetId")),Api.text(body,"name"),Api.text(body,"chartType").toLowerCase(Locale.ROOT),
        Api.text(body,"dimension"),Api.text(body,"metric"),Api.text(body,"aggregate").toLowerCase(Locale.ROOT),actor.id());
    auth.audit(actor,"CREATE","CHART",id);return id;
  }
  public Map<String,Object> data(UUID id,String filter){
    Map<String,Object> c=get(id);
    Map<String,Object> spec=Map.of("datasetId",c.get("dataset_id").toString(),"dimension",c.get("dimension"),
        "metric",c.get("metric"),"aggregate",c.get("aggregate"),"chartType",c.get("chart_type"));
    Map<String,Object> data=new LinkedHashMap<>(preview(spec,filter));
    data.put("id",id);data.put("name",c.get("name"));return data;
  }

  @RestController @RequestMapping("/api/charts")
  public static class Controller {
    private final Charts service;private final Auth auth;private final JdbcTemplate db;
    Controller(Charts service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @GetMapping List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @PostMapping("/preview") Map<String,Object> preview(@RequestBody Map<String,Object> body,HttpServletRequest request){auth.actor(request);return service.preview(body,null);}
    @PostMapping Map<String,Object> save(@RequestBody Map<String,Object> body,HttpServletRequest request){return Map.of("id",service.save(body,auth.actor(request)));}
    @GetMapping("/{id}/data") Map<String,Object> data(@PathVariable String id,@RequestParam(required=false) String filter,HttpServletRequest request){auth.actor(request);return service.data(Api.uuid(id),filter);}
    @DeleteMapping("/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      int n=db.update("DELETE FROM charts WHERE id=?",Api.uuid(id));if(n==0) throw Api.notFound();
      auth.audit(actor,"DELETE","CHART",id);return Map.of("ok",true);
    }
  }
}
