package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@Service
public class Dashboards {
  private final JdbcTemplate db;private final Charts charts;private final Auth auth;
  @org.springframework.beans.factory.annotation.Autowired private DashboardInteraction interaction;
  Dashboards(JdbcTemplate db,Charts charts,Auth auth){this.db=db;this.charts=charts;this.auth=auth;}
  public List<Map<String,Object>> list(){
    return db.queryForList("""
        SELECT d.id,d.name,d.owner_id,d.share_token,d.created_at,count(dc.chart_id) AS chart_count
        FROM dashboards d LEFT JOIN dashboard_charts dc ON dc.dashboard_id=d.id
        GROUP BY d.id ORDER BY d.created_at DESC
        """);
  }
  public Map<String,Object> detail(UUID id,String filter,String filterDimension){
    List<Map<String,Object>> rows=db.queryForList("SELECT id,name,owner_id,share_token,created_at FROM dashboards WHERE id=?",id);
    if(rows.isEmpty()) throw Api.notFound();
    if(!interaction.savedScope(id).isEmpty())return interaction.query(id,Map.of());
    List<Map<String,Object>> items=db.queryForList("SELECT chart_id,position,grid_x,grid_y,grid_w,grid_h FROM dashboard_charts WHERE dashboard_id=? ORDER BY position",id);
    List<Map<String,Object>> data=new ArrayList<>();
    for(Map<String,Object> item:items){
      UUID chartId=(UUID)item.get("chart_id");
      String dimension=charts.get(chartId).get("dimension").toString();
      String relevantFilter=filterDimension==null || filterDimension.isBlank() || filterDimension.equals(dimension) ? filter : null;
      Map<String,Object> chart=new LinkedHashMap<>(charts.data(chartId,relevantFilter));
      chart.put("position",item.get("position"));
      int position=((Number)item.get("position")).intValue();
      chart.put("x",item.get("grid_x")==null?(position%2)*6:item.get("grid_x"));
      chart.put("y",item.get("grid_y")==null?(position/2)*9:item.get("grid_y"));
      chart.put("w",item.get("grid_w")==null?6:item.get("grid_w"));
      chart.put("h",item.get("grid_h")==null?9:item.get("grid_h"));data.add(chart);
    }
    Map<String,Object> result=new LinkedHashMap<>(rows.get(0));result.put("charts",data);return result;
  }
  public UUID save(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);UUID id=UUID.randomUUID();
    db.update("INSERT INTO dashboards(id,name,owner_id) VALUES (?,?,?)",id,Api.text(body,"name"),actor.id());
    auth.audit(actor,"CREATE","DASHBOARD",id);return id;
  }
  @Transactional
  public void layout(UUID id,Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);
    if(db.queryForObject("SELECT count(*) FROM dashboards WHERE id=?",Integer.class,id)==0) throw Api.notFound();
    lock(id);
    var items=DashboardLayout.parse(body);
    var scope=interaction.savedScope(id);
    if(!scope.isEmpty())for(var item:items) {
      String datasetId=charts.definition(item.chartId()).get("datasetId").toString();
      if(scope.stream().noneMatch(f->datasetId.equals(f.get("datasetId"))))throw Api.bad("Dashboard có phạm vi đã lưu; chỉ thêm biểu đồ từ dataset cùng phạm vi");
    }
    // Serialize membership changes with chart edits, in a stable lock order.
    items.stream().map(DashboardLayout.Item::chartId).sorted().forEach(chartId->{
      if(db.queryForList("SELECT id FROM charts WHERE id=? FOR UPDATE",chartId).isEmpty())throw Api.notFound();
    });
    db.update("DELETE FROM dashboard_charts WHERE dashboard_id=?",id);
    int pos=0;
    for(var item:items)db.update("INSERT INTO dashboard_charts(dashboard_id,chart_id,position,grid_x,grid_y,grid_w,grid_h) VALUES (?,?,?,?,?,?,?)",
        id,item.chartId(),pos++,item.x(),item.y(),item.w(),item.h());
    auth.audit(actor,"UPDATE_LAYOUT","DASHBOARD",id);
  }
  private void lock(UUID id){
    if(db.queryForList("SELECT id FROM dashboards WHERE id=? FOR UPDATE",id).isEmpty())throw Api.notFound();
  }
  public void saveScope(UUID id,List<Map<String,Object>> filters,Auth.Actor actor){
    auth.canEdit(actor);interaction.saveScope(id,filters);
    auth.audit(actor,"SCOPE","DASHBOARD",id);
  }
  @Transactional
  public void rename(UUID id,Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);String name=Chat.bounded(Api.text(body,"name"),200,"Tên dashboard");
    if(db.update("UPDATE dashboards SET name=? WHERE id=?",name,id)==0)throw Api.notFound();
    auth.audit(actor,"RENAME","DASHBOARD",id);
  }
  @Transactional
  public Map<String,Object> editChart(UUID id,UUID chartId,Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);lock(id);
    if(db.queryForList("SELECT id FROM charts WHERE id=? FOR UPDATE",chartId).isEmpty())throw Api.notFound();
    if(db.queryForObject("SELECT count(*) FROM dashboard_charts WHERE dashboard_id=? AND chart_id=?",Integer.class,id,chartId)==0)throw Api.notFound();
    var original=charts.get(chartId);
    if(body.containsKey("datasetId") && !original.get("dataset_id").toString().equals(Api.text(body,"datasetId")))throw Api.bad("Không đổi dataset khi sửa biểu đồ; hãy thêm biểu đồ mới");
    Map<String,Object> spec=new LinkedHashMap<>(body);spec.put("datasetId",original.get("dataset_id").toString());
    spec.put("name",Chat.bounded(Api.text(spec,"name"),120,"Tiêu đề biểu đồ"));
    boolean shared=db.queryForObject("SELECT count(*) FROM dashboard_charts WHERE chart_id=?",Integer.class,chartId)>1;
    UUID saved=chartId;
    if(shared){
      saved=charts.save(spec,actor);
      db.update("UPDATE dashboard_charts SET chart_id=? WHERE dashboard_id=? AND chart_id=?",saved,id,chartId);
    }else charts.update(chartId,spec,actor);
    auth.audit(actor,"EDIT_CHART","DASHBOARD",id);
    return Map.of("chartId",saved,"copied",shared);
  }
  public UUID share(UUID id,Auth.Actor actor){
    auth.canEdit(actor);
    UUID token=UUID.randomUUID();int n=db.update("UPDATE dashboards SET share_token=? WHERE id=?",token,id);
    if(n==0) throw Api.notFound();auth.audit(actor,"SHARE","DASHBOARD",id);return token;
  }
  public void unshare(UUID id,Auth.Actor actor){
    auth.canEdit(actor);int n=db.update("UPDATE dashboards SET share_token=NULL WHERE id=?",id);
    if(n==0) throw Api.notFound();auth.audit(actor,"UNSHARE","DASHBOARD",id);
  }
  public Map<String,Object> publicView(UUID token){
    List<UUID> ids=db.query("SELECT id FROM dashboards WHERE share_token=?",(rs,n)->rs.getObject(1,UUID.class),token);
    if(ids.isEmpty()) throw Api.notFound();
    UUID id=ids.get(0);
    Map<String,Object> full=detail(id,null,null);
    db.update("INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES (NULL,'VIEW_PUBLIC','DASHBOARD',?)",id.toString());
    return Map.of("id",id,"name",full.get("name"),"charts",full.get("charts"));
  }

  @RestController @RequestMapping("/api")
  public static class Controller {
    private final Dashboards service;private final Auth auth;private final JdbcTemplate db;
    Controller(Dashboards service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @GetMapping("/dashboards") List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @PostMapping("/dashboards") Map<String,Object> save(@RequestBody Map<String,Object> body,HttpServletRequest request){return Map.of("id",service.save(body,auth.actor(request)));}
    @GetMapping("/dashboards/{id}") Map<String,Object> detail(@PathVariable String id,@RequestParam(required=false) String filter,@RequestParam(required=false) String filterDimension,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);Map<String,Object> result=service.detail(Api.uuid(id),filter,filterDimension);
      auth.audit(actor,"VIEW","DASHBOARD",id);return result;
    }
    @PutMapping("/dashboards/{id}") Map<String,Boolean> rename(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){service.rename(Api.uuid(id),body,auth.actor(request));return Map.of("ok",true);}
    @PutMapping("/dashboards/{id}/charts/{chartId}") Map<String,Object> editChart(@PathVariable String id,@PathVariable String chartId,@RequestBody Map<String,Object> body,HttpServletRequest request){return service.editChart(Api.uuid(id),Api.uuid(chartId),body,auth.actor(request));}
    @PutMapping("/dashboards/{id}/layout") Map<String,Boolean> layout(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){service.layout(Api.uuid(id),body,auth.actor(request));return Map.of("ok",true);}
    @PostMapping("/dashboards/{id}/share") Map<String,Object> share(@PathVariable String id,HttpServletRequest request){return Map.of("token",service.share(Api.uuid(id),auth.actor(request)));}
    @DeleteMapping("/dashboards/{id}/share") Map<String,Boolean> unshare(@PathVariable String id,HttpServletRequest request){service.unshare(Api.uuid(id),auth.actor(request));return Map.of("ok",true);}
    @DeleteMapping("/dashboards/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      if(db.queryForObject("SELECT count(*) FROM file_imports WHERE dashboard_id=?",Integer.class,Api.uuid(id))>0)
        throw Api.bad("Dashboard này được tạo từ CSV; hãy xóa tại trang Tải file & phân tích");
      int n=db.update("DELETE FROM dashboards WHERE id=?",Api.uuid(id));if(n==0) throw Api.notFound();
      auth.audit(actor,"DELETE","DASHBOARD",id);return Map.of("ok",true);
    }
    @GetMapping("/share/{token}") Map<String,Object> publicView(@PathVariable String token){return service.publicView(Api.uuid(token));}
  }
}
