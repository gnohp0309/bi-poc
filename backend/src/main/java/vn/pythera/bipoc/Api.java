package vn.pythera.bipoc;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import java.util.Map;
import java.util.UUID;

public final class Api {
  private Api() {}
  public static String text(Map<String, ?> body, String key) {
    Object value = body == null ? null : body.get(key);
    String s = value == null ? "" : value.toString().trim();
    if (s.isEmpty()) throw new Failure(400, "Thiếu trường " + key);
    return s;
  }
  public static String optional(Map<String, ?> body, String key) {
    Object value = body == null ? null : body.get(key);
    return value == null ? "" : value.toString().trim();
  }
  public static UUID uuid(String value) {
    try { return UUID.fromString(value); }
    catch (Exception e) { throw new Failure(400, "ID không hợp lệ"); }
  }
  public static int integer(Map<String, ?> body, String key, int fallback) {
    try { return body.get(key) == null ? fallback : Integer.parseInt(body.get(key).toString()); }
    catch (Exception e) { throw new Failure(400, "Số không hợp lệ: " + key); }
  }
  public static Failure bad(String message) { return new Failure(400, message); }
  public static Failure notFound() { return new Failure(404, "Không tìm thấy dữ liệu"); }
  public static class Failure extends RuntimeException {
    public final int status;
    public Failure(int status, String message) { super(message); this.status = status; }
  }
  @RestControllerAdvice
  public static class Handler {
    @ExceptionHandler(Failure.class)
    ResponseEntity<Map<String,String>> failure(Failure e) {
      return ResponseEntity.status(e.status).body(Map.of("error", e.getMessage()));
    }
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    ResponseEntity<Map<String,String>> conflict() {
      return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", "Dữ liệu đã tồn tại hoặc đang được sử dụng"));
    }
    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String,String>> uploadTooLarge() {
      return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of("error", "File vượt giới hạn 200 MB"));
    }
  }
}
