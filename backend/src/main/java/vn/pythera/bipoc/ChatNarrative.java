package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** A read-only interpretation of computed facts. Every displayed numeral comes from the engine. */
@Service
class ChatNarrative {
  private static final Pattern REFERENCE = Pattern.compile("\\[\\[([a-z_]+[0-9]*)]]");
  private static final Pattern NUMERAL = Pattern.compile("\\p{N}");
  private final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
  private final ObjectMapper mapper;
  private final String url;
  private final String internalKey;

  ChatNarrative(ObjectMapper mapper, @Value("${poc.ai.service.url:http://127.0.0.1:8000}") String url,
                @Value("${poc.secret.key:local-poc-key-change-before-sharing}") String internalKey) {
    this.mapper = mapper;
    this.url = url;
    this.internalKey = internalKey;
  }

  Optional<String> explain(String question, Map<?,?> report, String context) {
    JsonNode result = mapper.valueToTree(report);
    if (!"success".equals(result.path("status").asText())) return Optional.empty();
    Map<String,String> facts = evidence(result);
    if (facts.isEmpty()) return Optional.empty();
    try {
      String body = mapper.writeValueAsString(Map.of("question",question,"context",context,"evidence",facts));
      HttpRequest request = HttpRequest.newBuilder(URI.create(url + "/internal/interpret"))
          .timeout(Duration.ofSeconds(26)).header("Content-Type", "application/json; charset=utf-8")
          .header("X-POC-Internal-Key", internalKey).POST(HttpRequest.BodyPublishers.ofString(body)).build();
      var response = client.send(request, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() != 200 || response.body().length() > 10000) return Optional.empty();
      return render(mapper.readTree(response.body()).path("answer").asText(), facts);
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      return Optional.empty();
    } catch (IOException | IllegalArgumentException e) {
      return Optional.empty();
    }
  }

  static Map<String,String> evidence(JsonNode report) {
    Map<String,String> facts = new LinkedHashMap<>();
    for (String field : new String[]{"summary", "conclusion", "method"}) {
      int index = 1;
      for (String line : report.path(field).asText().split("\\R")) {
        if (!line.isBlank() && index <= 10 && facts.size() < 20) facts.put(field + index++, bounded(line, 580));
      }
    }
    for (String field : new String[]{"statistic", "pValue", "effectSize"}) {
      JsonNode measure=report.path(field);
      if ("available".equals(measure.path("status").asText()) && measure.path("value").isNumber()) {
        String label=switch(field) {
          case "pValue" -> "p-value";
          case "effectSize" -> "Kích thước hiệu ứng";
          default -> "Thống kê kiểm định";
        };
        facts.put(field.toLowerCase(java.util.Locale.ROOT), label+": "+measure.path("value").asText());
      }
    }
    JsonNode data = report.path("data");
    int index = 0;
    for (JsonNode row : data.path("rows")) {
      if (index >= 5) break;
      StringBuilder line = new StringBuilder();
      var fields = row.fields();
      while (fields.hasNext() && line.length() < 480) {
        var cell = fields.next();
        if (!cell.getValue().isValueNode()) continue;
        if (!line.isEmpty()) line.append(" · ");
        line.append(bounded(cell.getKey(), 80)).append(": ").append(bounded(cell.getValue().asText("NULL"), 160));
      }
      if (!line.isEmpty()) facts.put("row" + ++index, bounded(line.toString(), 580));
    }
    if (data.path("truncated").asBoolean() || data.path("rows").size() > 5)
      facts.put("scope", "Bằng chứng chỉ chứa một phần kết quả; không suy ra tổng hoặc cực trị toàn bộ từ phần này.");
    int warning = 0;
    for (JsonNode item : report.path("warnings")) {
      if (warning == 2) break;
      if (item.isTextual()) facts.put("warning" + ++warning, bounded(item.asText(), 580));
    }
    return facts;
  }

  static Optional<String> render(String template, Map<String,String> facts) {
    if (template.isBlank() || template.length() > 1200) return Optional.empty();
    Matcher refs = REFERENCE.matcher(template);
    String plain = refs.replaceAll("");
    if (NUMERAL.matcher(plain).find() || plain.contains("[[") || plain.contains("]]")) return Optional.empty();
    refs.reset();
    StringBuilder output = new StringBuilder();
    int count = 0;
    while (refs.find()) {
      String fact = facts.get(refs.group(1));
      if (fact == null || ++count > 8) return Optional.empty();
      refs.appendReplacement(output, Matcher.quoteReplacement(fact));
    }
    refs.appendTail(output);
    return count > 0 && output.length() <= 3600 ? Optional.of(output.toString().strip()) : Optional.empty();
  }

  static String bounded(String text, int limit) {
    return text.substring(0, Math.min(limit,text.length()));
  }
}
