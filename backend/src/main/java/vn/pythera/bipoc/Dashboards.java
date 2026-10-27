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
    List<Map<String,Object>> items=db.queryForList("SELECT chart_id,position FROM dashboard_charts WHERE dashboard_id=? ORDER BY position",id);
    List<Map<String,Object>> data=new ArrayList<>();
    for(Map<String,Object> item:items){
      UUID chartId=(UUID)item.get("chart_id");
      String dimension=charts.get(chartId).get("dimension").toString();
      String relevantFilter=filterDimension==null || filterDimension.isBlank() || filterDimension.equals(dimension) ? filter : null;
      Map<String,Object> chart=new LinkedHashMap<>(charts.data(chartId,relevantFilter));
      chart.put("position",item.get("position"));data.add(chart);
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
    Object raw=body.get("chartIds");
    if(!(raw instanceof List<?> ids) || ids.size()>24) throw Api.bad("Cần danh sách tối đa 24 biểu đồ");
    db.update("DELETE FROM dashboard_charts WHERE dashboard_id=?",id);
    Set<UUID> unique=new HashSet<>();int pos=0;
    for(Object item:ids){UUID chartId=Api.uuid(item.toString());charts.get(chartId);
      if(unique.add(chartId)) db.update("INSERT INTO dashboard_charts(dashboard_id,chart_id,position) VALUES (?,?,?)",id,chartId,pos++);
    }
    auth.audit(actor,"UPDATE_LAYOUT","DASHBOARD",id);
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
