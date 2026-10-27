package vn.pythera.bipoc;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@Service
public class Datasets {
  private final JdbcTemplate db;private final Queries queries;private final Connections connections;
  private final Auth auth;private final ObjectMapper mapper;
  Datasets(JdbcTemplate db,Queries queries,Connections connections,Auth auth,ObjectMapper mapper){
    this.db=db;this.queries=queries;this.connections=connections;this.auth=auth;this.mapper=mapper;
  }
  public Map<String,Object> get(UUID id){
    List<Map<String,Object>> rows=db.queryForList("SELECT * FROM datasets WHERE id=?",id);
    if(rows.isEmpty()) throw Api.notFound();return rows.get(0);
  }
  public String source(Map<String,Object> dataset){
    if(dataset.get("kind").equals("VIRTUAL")) return "("+Queries.safeSql(dataset.get("sql_definition").toString())+") data";
    String[] bits=dataset.get("source_name").toString().split("\\.",2);
    if(bits.length!=2) throw Api.bad("Bảng nguồn không hợp lệ");
    return Queries.identifier(bits[0])+"."+Queries.identifier(bits[1]);
  }
  public List<Map<String,Object>> list(){
    return db.queryForList("""
        SELECT d.id,d.connection_id,d.name,d.kind,d.source_name,d.sql_definition,d.aliases_json,d.owner_id,d.created_at,
        c.name AS connection_name FROM datasets d JOIN db_connections c ON c.id=d.connection_id ORDER BY d.created_at DESC
        """);
  }
  public Map<String,Object> preview(UUID id){
    Map<String,Object> dataset=get(id);
    return queries.run((UUID)dataset.get("connection_id"),"SELECT * FROM "+source(dataset)+" LIMIT 20");
  }
  public UUID save(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);
    UUID conn=Api.uuid(Api.text(body,"connectionId"));
    String kind=Api.text(body,"kind").toUpperCase(Locale.ROOT);
    if(!Set.of("PHYSICAL","VIRTUAL").contains(kind)) throw Api.bad("Loại dataset không hợp lệ");
    String table=null,sql=null;
    if(kind.equals("PHYSICAL")){
      table=Api.text(body,"sourceName");
      String[] bits=table.split("\\.",2);
      if(bits.length!=2) throw Api.bad("Chọn bảng theo dạng schema.table");
      String finalTable=Queries.identifier(bits[0])+"."+Queries.identifier(bits[1]);
      queries.run(conn,"SELECT * FROM "+finalTable+" LIMIT 1");
    }else{
      sql=Queries.safeSql(Api.text(body,"sql"));
      queries.run(conn,"SELECT * FROM ("+sql+") data LIMIT 1");
    }
    UUID id=UUID.randomUUID();
    db.update("INSERT INTO datasets(id,connection_id,name,kind,source_name,sql_definition,owner_id) VALUES (?,?,?,?,?,?,?)",
        id,conn,Api.text(body,"name"),kind,table,sql,actor.id());
    auth.audit(actor,"CREATE","DATASET",id);return id;
  }
  public void aliases(UUID id,Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);get(id);
    Object value=body.get("aliases");
    if(!(value instanceof Map<?,?> aliases)) throw Api.bad("Aliases phải là đối tượng JSON");
    for(var item:aliases.entrySet()) if(!(item.getKey() instanceof String) || !(item.getValue() instanceof String)) throw Api.bad("Alias không hợp lệ");
    try{db.update("UPDATE datasets SET aliases_json=? WHERE id=?",mapper.writeValueAsString(aliases),id);}
    catch(JsonProcessingException e){throw Api.bad("Alias không hợp lệ");}
    auth.audit(actor,"UPDATE","DATASET",id);
  }

  @RestController @RequestMapping("/api/datasets")
  public static class Controller {
    private final Datasets service;private final Auth auth;private final JdbcTemplate db;
    Controller(Datasets service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @GetMapping List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @PostMapping Map<String,Object> save(@RequestBody Map<String,Object> body,HttpServletRequest request){return Map.of("id",service.save(body,auth.actor(request)));}
    @GetMapping("/{id}/preview") Map<String,Object> preview(@PathVariable String id,HttpServletRequest request){auth.actor(request);return service.preview(Api.uuid(id));}
    @PutMapping("/{id}/aliases") Map<String,Boolean> aliases(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request){service.aliases(Api.uuid(id),body,auth.actor(request));return Map.of("ok",true);}
    @DeleteMapping("/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      if(db.queryForObject("SELECT count(*) FROM file_imports WHERE dataset_id=? OR month_dataset_id=?",Integer.class,Api.uuid(id),Api.uuid(id))>0)
        throw Api.bad("Dataset này thuộc một file CSV; hãy xóa tại trang Tải file & phân tích");
      int n=db.update("DELETE FROM datasets WHERE id=?",Api.uuid(id));if(n==0) throw Api.notFound();
      auth.audit(actor,"DELETE","DATASET",id);return Map.of("ok",true);
    }
  }
}
