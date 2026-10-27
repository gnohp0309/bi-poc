package vn.pythera.bipoc;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.*;

@Component
public class Auth {
  private final JdbcTemplate db;
  private final BCryptPasswordEncoder encoder;
  private final SecureRandom random = new SecureRandom();

  Auth(JdbcTemplate db, BCryptPasswordEncoder encoder) { this.db = db; this.encoder = encoder; }

  public record Actor(UUID id, String username, String role) {}

  public Actor actor(HttpServletRequest request) {
    Object value = request.getAttribute("actor");
    if (value instanceof Actor actor) return actor;
    throw new Api.Failure(401, "Bạn cần đăng nhập");
  }
  public void canEdit(Actor actor) {
    if (actor.role().equals("VIEWER")) throw new Api.Failure(403, "Tài khoản chỉ có quyền xem");
  }
  public void admin(Actor actor) {
    if (!actor.role().equals("ADMIN")) throw new Api.Failure(403, "Chỉ quản trị viên được thực hiện");
  }
  public void audit(Actor actor, String action, String type, Object id) {
    db.update("INSERT INTO audit_logs(actor_id,action,object_type,object_id) VALUES (?,?,?,?)",
        actor.id(), action, type, id == null ? null : id.toString());
  }
  public String hash(String raw) {
    try {
      byte[] bytes = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(bytes);
    } catch (Exception e) { throw new IllegalStateException(e); }
  }
  public Actor fromToken(String token) {
    if (token == null || token.length() < 32) return null;
    List<Actor> users = db.query("""
        SELECT u.id,u.username,u.role FROM auth_sessions s
        JOIN app_users u ON u.id=s.user_id
        WHERE s.token_hash=? AND s.expires_at > now() AND u.active=true
        """, (rs,n) -> new Actor(rs.getObject("id", UUID.class), rs.getString("username"), rs.getString("role")), hash(token));
    return users.isEmpty() ? null : users.get(0);
  }
  public Map<String,Object> login(String username, String password) {
    List<Map<String,Object>> matches = db.queryForList("SELECT id,username,password_hash,role FROM app_users WHERE username=? AND active=true", username);
    if (matches.isEmpty() || !encoder.matches(password, matches.get(0).get("password_hash").toString()))
      throw new Api.Failure(401, "Sai tên đăng nhập hoặc mật khẩu");
    Map<String,Object> user = matches.get(0);
    byte[] bytes = new byte[32]; random.nextBytes(bytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    UUID id = (UUID) user.get("id");
    db.update("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)",
        hash(token), id, OffsetDateTime.now().plusHours(12));
    audit(new Actor(id,username,user.get("role").toString()), "LOGIN", "USER", id);
    return Map.of("token",token,"user",Map.of("id",id,"username",username,"role",user.get("role")));
  }

  @Component @Order(1)
  public static class Guard extends OncePerRequestFilter {
    private final Auth auth;
    Guard(Auth auth) { this.auth = auth; }
    @Override protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
        throws ServletException, IOException {
      String path = req.getRequestURI();
      if (!path.startsWith("/api/") || path.equals("/api/auth/login") || path.equals("/api/health") || path.startsWith("/api/share/")) {
        chain.doFilter(req,res); return;
      }
      String header = req.getHeader("Authorization");
      Actor actor = header != null && header.startsWith("Bearer ") ? auth.fromToken(header.substring(7)) : null;
      if (actor == null) {
        res.setStatus(401); res.setContentType("application/json;charset=UTF-8");
        res.getWriter().write("{\"error\":\"Bạn cần đăng nhập\"}"); return;
      }
      req.setAttribute("actor", actor);
      chain.doFilter(req,res);
    }
  }

  @RestController @RequestMapping("/api")
  public static class Controller {
    private final Auth auth;
    private final JdbcTemplate db;
    private final BCryptPasswordEncoder encoder;
    Controller(Auth auth, JdbcTemplate db, BCryptPasswordEncoder encoder) {
      this.auth=auth; this.db=db; this.encoder=encoder;
    }
    @GetMapping("/health") Map<String,String> health() { return Map.of("status","ok"); }
    @PostMapping("/auth/login") Map<String,Object> login(@RequestBody Map<String,Object> body) {
      return auth.login(Api.text(body,"username"), Api.text(body,"password"));
    }
    @GetMapping("/auth/me") Actor me(HttpServletRequest request) { return auth.actor(request); }
    @PostMapping("/auth/logout") Map<String,Boolean> logout(HttpServletRequest request) {
      String header=request.getHeader("Authorization");
      if(header!=null && header.startsWith("Bearer ")) db.update("DELETE FROM auth_sessions WHERE token_hash=?", auth.hash(header.substring(7)));
      return Map.of("ok",true);
    }
    @GetMapping("/users") List<Map<String,Object>> users(HttpServletRequest request) {
      auth.admin(auth.actor(request));
      return db.queryForList("SELECT id,username,role,active,created_at FROM app_users ORDER BY username");
    }
    @PostMapping("/users") Map<String,Object> user(@RequestBody Map<String,Object> body,HttpServletRequest request) {
      Actor actor=auth.actor(request); auth.admin(actor);
      String role=Api.text(body,"role").toUpperCase(Locale.ROOT);
      if(!Set.of("ADMIN","ANALYST","VIEWER").contains(role)) throw Api.bad("Vai trò không hợp lệ");
      UUID id=UUID.randomUUID();
      db.update("INSERT INTO app_users(id,username,password_hash,role) VALUES (?,?,?,?)",
          id,Api.text(body,"username"),encoder.encode(Api.text(body,"password")),role);
      auth.audit(actor,"CREATE","USER",id);
      return Map.of("id",id,"role",role);
    }
    @GetMapping("/groups") List<Map<String,Object>> groups(HttpServletRequest request) {
      auth.admin(auth.actor(request));
      return db.queryForList("""
          SELECT g.id,g.name,coalesce(array_agg(m.user_id) FILTER (WHERE m.user_id IS NOT NULL),'{}') AS members
          FROM app_groups g LEFT JOIN group_members m ON m.group_id=g.id GROUP BY g.id ORDER BY g.name
          """);
    }
    @PostMapping("/groups") Map<String,Object> group(@RequestBody Map<String,Object> body,HttpServletRequest request) {
      Actor actor=auth.actor(request); auth.admin(actor); UUID id=UUID.randomUUID();
      db.update("INSERT INTO app_groups(id,name) VALUES (?,?)",id,Api.text(body,"name"));
      auth.audit(actor,"CREATE","GROUP",id); return Map.of("id",id);
    }
    @PostMapping("/groups/{id}/members") Map<String,Boolean> member(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest request) {
      Actor actor=auth.actor(request); auth.admin(actor);
      db.update("INSERT INTO group_members(group_id,user_id) VALUES (?,?) ON CONFLICT DO NOTHING",Api.uuid(id),Api.uuid(Api.text(body,"userId")));
      auth.audit(actor,"ADD_MEMBER","GROUP",id); return Map.of("ok",true);
    }
    @GetMapping("/audit") List<Map<String,Object>> audit(HttpServletRequest request) {
      auth.admin(auth.actor(request));
      return db.queryForList("""
          SELECT a.id,u.username AS actor,a.action,a.object_type,a.object_id,a.created_at
          FROM audit_logs a LEFT JOIN app_users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 100
          """);
    }
  }
}
