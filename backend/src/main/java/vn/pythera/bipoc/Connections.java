package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.*;

@Service
public class Connections {
  private final JdbcTemplate db;
  private final Auth auth;
  private final SecretKeySpec key;
  private final Set<String> allowedHosts;
  private final SecureRandom random = new SecureRandom();

  Connections(JdbcTemplate db, Auth auth, @Value("${poc.secret.key}") String secret,
      @Value("${poc.allowed-db-hosts}") String allowed) throws Exception {
    this.db=db; this.auth=auth;
    this.key=new SecretKeySpec(MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)),"AES");
    this.allowedHosts=new HashSet<>(Arrays.asList(allowed.toLowerCase(Locale.ROOT).split(",")));
  }
  private void hostAllowed(String host) {
    if (!allowedHosts.contains(host.toLowerCase(Locale.ROOT)))
      throw Api.bad("Máy chủ CSDL không nằm trong danh sách được phép của bản demo");
  }
  private String encrypt(String value) {
    try {
      byte[] iv=new byte[12]; random.nextBytes(iv);
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE,key,new GCMParameterSpec(128,iv));
      byte[] body=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      byte[] all=new byte[iv.length+body.length];
      System.arraycopy(iv,0,all,0,iv.length); System.arraycopy(body,0,all,iv.length,body.length);
      return Base64.getEncoder().encodeToString(all);
    } catch(Exception e) { throw new IllegalStateException("Không mã hóa được mật khẩu",e); }
  }
  private String decrypt(String value) {
    try {
      byte[] all=Base64.getDecoder().decode(value);
      Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Arrays.copyOfRange(all,0,12)));
      return new String(cipher.doFinal(all,12,all.length-12),StandardCharsets.UTF_8);
    } catch(Exception e) { throw new IllegalStateException("Không giải mã được kết nối",e); }
  }
  private Connection connect(String host,int port,String database,String username,String password) throws SQLException {
    hostAllowed(host);
    if(port<1 || port>65535 || !database.matches("[A-Za-z0-9_-]{1,63}")) throw Api.bad("Cấu hình kết nối không hợp lệ");
    Properties props=new Properties();
    props.setProperty("user",username); props.setProperty("password",password);
    props.setProperty("connectTimeout","3"); props.setProperty("socketTimeout","8");
    return DriverManager.getConnection("jdbc:postgresql://"+host+":"+port+"/"+database,props);
  }
  public Connection open(UUID id) throws SQLException {
    List<Map<String,Object>> rows=db.queryForList("SELECT * FROM db_connections WHERE id=?",id);
    if(rows.isEmpty()) throw Api.notFound();
    Map<String,Object> row=rows.get(0);
    return connect(row.get("host").toString(),((Number)row.get("port")).intValue(),
        row.get("database_name").toString(),row.get("username").toString(),decrypt(row.get("password_cipher").toString()));
  }
  public List<Map<String,Object>> list() {
    return db.queryForList("SELECT id,name,host,port,database_name,username,owner_id,created_at FROM db_connections ORDER BY created_at DESC");
  }
  public Map<String,Object> test(Map<String,Object> body) {
    try(Connection c=connect(Api.text(body,"host"),Api.integer(body,"port",5432),Api.text(body,"database"),
        Api.text(body,"username"),Api.text(body,"password"))) {
      return Map.of("ok",c.isValid(2),"database",c.getCatalog());
    } catch(SQLException e) { throw Api.bad("Không kết nối được. Kiểm tra host, cổng, tên CSDL và tài khoản."); }
  }
  public UUID save(Map<String,Object> body, Auth.Actor actor) {
    auth.canEdit(actor); test(body); UUID id=UUID.randomUUID();
    db.update("""
        INSERT INTO db_connections(id,name,host,port,database_name,username,password_cipher,owner_id)
        VALUES (?,?,?,?,?,?,?,?)
        """,id,Api.text(body,"name"),Api.text(body,"host"),Api.integer(body,"port",5432),
        Api.text(body,"database"),Api.text(body,"username"),encrypt(Api.text(body,"password")),actor.id());
    auth.audit(actor,"CREATE","CONNECTION",id); return id;
  }
  public List<Map<String,Object>> tables(UUID id) {
    try(Connection c=open(id); var st=c.prepareStatement("""
        SELECT table_schema,table_name FROM information_schema.tables
        WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
        ORDER BY table_schema,table_name
        """); var rs=st.executeQuery()) {
      List<Map<String,Object>> rows=new ArrayList<>();
      while(rs.next()) rows.add(Map.of("schema",rs.getString(1),"table",rs.getString(2)));
      return rows;
    } catch(SQLException e) { throw Api.bad("Không đọc được danh sách bảng"); }
  }
  public List<Map<String,Object>> columns(UUID id,String schema,String table) {
    try(Connection c=open(id); var st=c.prepareStatement("""
        SELECT column_name,data_type FROM information_schema.columns
        WHERE table_schema=? AND table_name=? ORDER BY ordinal_position
        """)) {
      st.setString(1,schema); st.setString(2,table);
      try(var rs=st.executeQuery()) {
        List<Map<String,Object>> rows=new ArrayList<>();
        while(rs.next()) rows.add(Map.of("name",rs.getString(1),"type",rs.getString(2)));
        return rows;
      }
    } catch(SQLException e) { throw Api.bad("Không đọc được cấu trúc bảng"); }
  }

  @RestController @RequestMapping("/api/connections")
  public static class Controller {
    private final Connections service; private final Auth auth; private final JdbcTemplate db;
    Controller(Connections service,Auth auth,JdbcTemplate db){this.service=service;this.auth=auth;this.db=db;}
    @GetMapping List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @PostMapping("/test") Map<String,Object> test(@RequestBody Map<String,Object> body,HttpServletRequest request){auth.canEdit(auth.actor(request));return service.test(body);}
    @PostMapping Map<String,Object> create(@RequestBody Map<String,Object> body,HttpServletRequest request){return Map.of("id",service.save(body,auth.actor(request)));}
    @GetMapping("/{id}/tables") List<Map<String,Object>> tables(@PathVariable String id,HttpServletRequest request){auth.actor(request);return service.tables(Api.uuid(id));}
    @GetMapping("/{id}/columns") List<Map<String,Object>> columns(@PathVariable String id,@RequestParam String schema,@RequestParam String table,HttpServletRequest request){auth.actor(request);return service.columns(Api.uuid(id),schema,table);}
    @DeleteMapping("/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      Auth.Actor actor=auth.actor(request);auth.canEdit(actor);
      if(db.queryForObject("SELECT count(*) FROM file_imports f JOIN datasets d ON d.id=f.dataset_id WHERE d.connection_id=?",Integer.class,Api.uuid(id))>0)
        throw Api.bad("Kết nối này đang chứa file CSV; hãy xóa tại trang Tải file & phân tích");
      int n=db.update("DELETE FROM db_connections WHERE id=?",Api.uuid(id)); if(n==0) throw Api.notFound();
      auth.audit(actor,"DELETE","CONNECTION",id);return Map.of("ok",true);
    }
  }
}
