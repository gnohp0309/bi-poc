package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.sql.*;
import java.util.*;

@Service
public class Queries {
  private final Connections connections; private final JdbcTemplate db; private final Auth auth;
  Queries(Connections connections,JdbcTemplate db,Auth auth){this.connections=connections;this.db=db;this.auth=auth;}

  public static String safeSql(String sql) {
    String value=sql == null ? "" : sql.strip();
    if(value.endsWith(";")) value=value.substring(0,value.length()-1).strip();
    if(value.length()>10000 || value.contains(";") || !value.matches("(?is)^(SELECT|WITH)\\b.*"))
      throw Api.bad("Chỉ cho phép một truy vấn SELECT/WITH, tối đa 10.000 ký tự");
    return value;
  }
  public static String identifier(String value) {
    if(value==null || !value.matches("[A-Za-z_][A-Za-z0-9_]*")) throw Api.bad("Tên cột/bảng không hợp lệ");
    return "\""+value+"\"";
  }
  public Map<String,Object> run(UUID connectionId,String sql,Object... params) {
    String checked=safeSql(sql);
    try(Connection c=connections.open(connectionId)) {
      c.setReadOnly(true); c.setAutoCommit(false);
      try(Statement tx=c.createStatement()){tx.execute("SET TRANSACTION READ ONLY");}
      try(PreparedStatement st=c.prepareStatement(checked)) {
        st.setQueryTimeout(6); st.setMaxRows(501);
        for(int i=0;i<params.length;i++) st.setObject(i+1,params[i]);
        try(ResultSet rs=st.executeQuery()) {
          ResultSetMetaData meta=rs.getMetaData(); int count=meta.getColumnCount();
          List<String> columns=new ArrayList<>();
          for(int i=1;i<=count;i++) columns.add(meta.getColumnLabel(i));
          List<Map<String,Object>> rows=new ArrayList<>(); boolean truncated=false;
          while(rs.next()) {
            if(rows.size()>=500){truncated=true;break;}
            Map<String,Object> row=new LinkedHashMap<>();
            for(int i=1;i<=count;i++) row.put(columns.get(i-1),rs.getObject(i));
            rows.add(row);
          }
          c.rollback();
          return Map.of("columns",columns,"rows",rows,"truncated",truncated);
        }
      }
    } catch(SQLException e) { throw Api.bad("Truy vấn thất bại: "+e.getMessage()); }
  }

  @RestController @RequestMapping("/api/sql")
  public static class Controller {
    private final Queries service;private final Auth auth;private final JdbcTemplate db;
    Controller(Queries service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @PostMapping("/execute") Map<String,Object> execute(@RequestBody Map<String,Object> body,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      UUID connectionId=Api.uuid(Api.text(body,"connectionId"));
      Map<String,Object> result=service.run(connectionId,Api.text(body,"sql"));
      auth.audit(actor,"EXECUTE","SQL",connectionId);return result;
    }
    @GetMapping("/saved") List<Map<String,Object>> saved(HttpServletRequest request){
      auth.actor(request);
      return db.queryForList("SELECT id,connection_id,name,sql_text,owner_id,created_at FROM saved_queries ORDER BY created_at DESC");
    }
    @PostMapping("/saved") Map<String,Object> save(@RequestBody Map<String,Object> body,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);UUID id=UUID.randomUUID();
      db.update("INSERT INTO saved_queries(id,connection_id,name,sql_text,owner_id) VALUES (?,?,?,?,?)",id,
          Api.uuid(Api.text(body,"connectionId")),Api.text(body,"name"),safeSql(Api.text(body,"sql")),actor.id());
      auth.audit(actor,"CREATE","SAVED_QUERY",id);return Map.of("id",id);
    }
  }
}
