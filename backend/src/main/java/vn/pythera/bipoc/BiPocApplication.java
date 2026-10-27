package vn.pythera.bipoc;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.util.UUID;

@SpringBootApplication
public class BiPocApplication {
  public static void main(String[] args) { SpringApplication.run(BiPocApplication.class, args); }

  @Bean BCryptPasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }

  @Bean CommandLineRunner seedAdmin(JdbcTemplate db, BCryptPasswordEncoder encoder,
      @Value("${poc.admin.password}") String password) {
    return args -> {
      Integer count = db.queryForObject("SELECT count(*) FROM app_users WHERE username = 'admin'", Integer.class);
      if (count != null && count == 0) {
        db.update("INSERT INTO app_users(id,username,password_hash,role) VALUES (?,?,?,'ADMIN')",
            UUID.randomUUID(), "admin", encoder.encode(password));
      }
    };
  }
}
