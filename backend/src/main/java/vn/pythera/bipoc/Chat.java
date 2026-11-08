package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.*;

/** AI proposes a plan; only the dataset-scoped analysis/chart services execute it. */
@Service
public class Chat {
  private final JdbcTemplate db;
  private final Datasets datasets;
  private final DatasetAnalysis analysis;
  private final Auth auth;
  private final ObjectMapper mapper;
  private final ObjectReader responseReader;
  private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  private final String aiServiceUrl;
  private final Charts charts;
  private final Dashboards dashboards;
  private final DashboardTemplates templates;
  private Statistics statistics;
  private DatasetExploration exploration;
  @org.springframework.beans.factory.annotation.Autowired
  void explorationServices(Statistics statistics,DatasetExploration exploration) {
    this.statistics=statistics;this.exploration=exploration;
  }

  record AIResponse(String request_id,String intent,JsonNode query_config,Boolean useTemplate,
      String templateId,String dashboard_name,Map<String,String> mapping,
      List<Map<String,Object>> charts,String clarification,String explanation,JsonNode statistics_config) {
    AIResponse(String request_id,String intent,JsonNode query_config,Boolean useTemplate,String templateId,
        String dashboard_name,Map<String,String> mapping,List<Map<String,Object>> charts,String clarification,String explanation) {
      this(request_id,intent,query_config,useTemplate,templateId,dashboard_name,mapping,charts,clarification,explanation,null);
    }
  }

  Chat(JdbcTemplate db,Datasets datasets,DatasetAnalysis analysis,Auth auth,ObjectMapper mapper,
       @Value("${poc.ai.service.url:http://127.0.0.1:8000}") String aiServiceUrl,
       Charts charts,Dashboards dashboards,DashboardTemplates templates) {
    this.db=db; this.datasets=datasets; this.analysis=analysis; this.auth=auth; this.mapper=mapper;
    this.aiServiceUrl=aiServiceUrl; this.charts=charts; this.dashboards=dashboards; this.templates=templates;
    this.responseReader=mapper.readerFor(AIResponse.class).with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
  }
  public List<Map<String,Object>> listConversations(Auth.Actor actor) {
    return db.queryForList("""
        SELECT c.id,c.dataset_id,c.title,c.created_at,c.updated_at,d.name AS dataset_name,
        (SELECT count(*) FROM chat_messages WHERE conversation_id=c.id) AS message_count
        FROM conversations c JOIN datasets d ON d.id=c.dataset_id
        WHERE c.user_id=? ORDER BY c.updated_at DESC,c.id LIMIT 50
        """,actor.id());
  }
  public Map<String,Object> getConversation(UUID id,Auth.Actor actor) {
    Map<String,Object> result=new LinkedHashMap<>(ownedConversation(id,actor));
    result.put("messages",db.queryForList("""
        SELECT id,role,content,metadata_json,created_at FROM chat_messages
        WHERE conversation_id=? ORDER BY created_at,sequence
        """,id));
    return result;
  }
  private Map<String,Object> ownedConversation(UUID id,Auth.Actor actor) {
    var rows=db.queryForList("SELECT id,dataset_id,title,created_at,updated_at FROM conversations WHERE id=? AND user_id=?",id,actor.id());
    if(rows.isEmpty()) throw Api.notFound();
    return rows.get(0);
  }
  @Transactional
  public UUID createConversation(UUID datasetId,String title,Auth.Actor actor) {
    auth.canEdit(actor);
    title=bounded(title,200,"Tên hội thoại");
    datasets.get(datasetId);
    UUID id=UUID.randomUUID();
    db.update("INSERT INTO conversations(id,user_id,dataset_id,title) VALUES (?,?,?,?)",id,actor.id(),datasetId,title);
    auth.audit(actor,"CREATE","CONVERSATION",id);
    return id;
  }
  @Transactional
  public Map<String,Object> sendMessage(UUID conversationId,String message,Auth.Actor actor) {
    // Check before reading source metadata or contacting a paid AI provider.
    auth.canEdit(actor);
    message=bounded(message,4000,"Câu hỏi");
    UUID datasetId=(UUID)ownedConversation(conversationId,actor).get("dataset_id");
    DatasetAnalysis.Metadata metadata=analysis.metadata(datasetId);
    List<Map<String,Object>> history=db.queryForList("""
        SELECT role,content,metadata_json FROM chat_messages WHERE conversation_id=?
        ORDER BY created_at DESC,sequence DESC LIMIT 10
        """,conversationId);
    Collections.reverse(history);
    List<Map<String,Object>> context=new ArrayList<>();
    for(var saved:history) {
      Map<String,Object> item=new LinkedHashMap<>();
      String content=saved.get("content").toString();
      item.put("role",saved.get("role"));
      item.put("content",content.substring(0,Math.min(4000,content.length())));
      try {
        JsonNode extra=mapper.readTree(saved.get("metadata_json").toString());
        if(extra.has("query_config")) item.put("query_config",extra.get("query_config"));
      } catch(java.io.IOException ignored) { /* Older messages may have no structured context. */ }
      context.add(item);
    }
    String requestId=UUID.randomUUID().toString();
    Map<String,Object> request=Map.of("request_id",requestId,"question",message,"dataset_name",metadata.name(),
        "columns",metadata.columns().stream().map(c->Map.of("name",c.name(),"type",c.type(),"kind",c.kind(),
            "friendly_name",c.label(),"aggregates",c.aggregates(),"timeGrains",c.timeGrains())).toList(),
        "conversation_history",context);
    AIResponse plan=callAI(request);
    if(!requestId.equals(plan.request_id())) throw new Api.Failure(502,"Phản hồi AI không khớp yêu cầu");
    return executePlan(conversationId,datasetId,message,plan,actor);
  }
  AIResponse callAI(Map<String,Object> body) {
    try {
      HttpRequest request=HttpRequest.newBuilder(URI.create(aiServiceUrl+"/analyze"))
          .timeout(Duration.ofSeconds(60)).header("Content-Type","application/json; charset=utf-8")
          .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body),StandardCharsets.UTF_8)).build();
      HttpResponse<String> response=client.send(request,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if(response.statusCode()!=200) {
        String code=response.headers().firstValue("X-AI-Error-Code").orElse("");
        String message=switch(code) {
          case "INVALID_PLAN" -> "AI trả cấu hình phân tích hoặc dashboard chưa hợp lệ; hãy thử lại hoặc nêu rõ yêu cầu";
          case "MISSING_API_KEY" -> "Chưa cấu hình Gemini API key trên dịch vụ AI";
          case "PROVIDER_TIMEOUT" -> "Gemini phản hồi quá lâu; vui lòng thử lại";
          default -> "Dịch vụ AI chưa sẵn sàng; kiểm tra cấu hình, API key hoặc hạn mức";
        };
        throw new Api.Failure(code.equals("PROVIDER_TIMEOUT")?504:502,message);
      }
      if(response.body().length()>100000) throw new Api.Failure(502,"Phản hồi AI vượt giới hạn");
      return responseReader.readValue(response.body());
    } catch(Api.Failure e) { throw e; }
    catch(InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new Api.Failure(503,"Yêu cầu AI đã bị gián đoạn; vui lòng thử lại");
    } catch(java.net.http.HttpTimeoutException e) {
      throw new Api.Failure(504,"Dịch vụ AI phản hồi quá lâu; vui lòng thử lại");
    } catch(java.io.IOException|IllegalArgumentException e) {
      throw new Api.Failure(502,"Không nhận được phản hồi AI hợp lệ; kiểm tra dịch vụ AI");
    }
  }
  // Invoked inside sendMessage's transaction: any failed chart/message rolls back the entire turn.
  Map<String,Object> executePlan(UUID conversationId,UUID datasetId,String message,AIResponse plan,Auth.Actor actor) {
    auth.canEdit(actor);
    Map<String,Object> extra=new LinkedHashMap<>();
    Map<String,Object> result=new LinkedHashMap<>();
    String answer;
    if("query".equals(plan.intent())) {
      if(plan.query_config()==null || !plan.query_config().isObject()) throw Api.bad("AI chưa đề xuất cấu hình phân tích hợp lệ");
      Map<String,Object> data=analysis.analyze(datasetId,plan.query_config(),actor);
      answer=formatAnswer(data);
      extra.put("query_config",plan.query_config());
      extra.put("data",data);
      extra.put("has_data",true);
      extra.put("row_count",data.get("rowCount"));
      result.put("data",data);
      Map<String,Object> presentation=ChatAnalysisPresentation.query(datasetId,data,plan.query_config());
      extra.put("analysis_result",presentation);
      result.put("analysis_result",presentation);
    } else if("statistical".equals(plan.intent())) {
      Map<String,Object> report=statistics.execute(datasetId,plan.statistics_config(),actor);
      extra.put("analysis_result",report);extra.put("statistics_config",plan.statistics_config());
      result.put("analysis_result",report);
      answer=Objects.toString(report.get("summary"),"Đã tính kết quả thống kê trên dataset.");
      if(report.containsKey("conclusion")) answer+="\n"+report.get("conclusion");
    } else if("explore".equals(plan.intent())) {
      Map<String,Object> report=exploration.report(datasetId);
      @SuppressWarnings("unchecked") var columns=(List<Map<String,Object>>)report.get("columns");
      List<Map<String,Object>> rows=new ArrayList<>();
      for(var column:columns){Map<String,Object> row=new LinkedHashMap<>();
        for(String key:List.of("name","type","nullCount","missingCount","missingRate","distinctCount","invalidCount"))row.put(key,column.get(key));rows.add(row);}
      var data=Map.<String,Object>of("datasetId",datasetId,"columns",List.of("name","type","nullCount","missingCount","missingRate","distinctCount","invalidCount"),"rows",rows,"rowCount",rows.size(),"truncated",false);
      @SuppressWarnings("unchecked") var overview=(Map<String,Object>)report.get("overview");
      @SuppressWarnings("unchecked") var quality=(Map<String,Object>)report.get("quality");
      answer="Dataset có "+overview.get("rowCount")+" dòng, "+overview.get("columnCount")+" cột dữ liệu.\n"+
          "Ô thiếu hiện tại: "+quality.get("missingCells")+"; giá trị số không hữu hạn: "+quality.get("invalidCells")+"; dòng trùng dư: "+quality.get("duplicateRows")+".\n"+
          "Bảng bên dưới có kiểu dữ liệu, tỷ lệ thiếu và số giá trị duy nhất từng cột. Phân tích chỉ đọc, không tự sửa/xóa dữ liệu.";
      Map<String,Object> presentation=new LinkedHashMap<>();
      presentation.put("schemaVersion",1);presentation.put("kind","query");presentation.put("status","success");presentation.put("title","Khám phá chất lượng dataset");
      presentation.put("summary",answer);presentation.put("data",data);presentation.put("warnings",report.get("warnings"));presentation.put("charts",List.of());
      presentation.put("provenance",Map.of("engine","PostgreSQL profiling","scope","dataset-definition","sampled",false));
      extra.put("analysis_result",presentation);extra.put("exploration",report);result.put("analysis_result",presentation);
    } else if("create_dashboard".equals(plan.intent())) {
      String name=bounded(plan.dashboard_name(),120,"Tên dashboard");
      UUID dashboardId;
      if(Boolean.TRUE.equals(plan.useTemplate())) {
        if(plan.templateId()==null || plan.mapping()==null) throw Api.bad("AI chưa ánh xạ đủ template");
        dashboardId=(UUID)templates.create(Map.of("datasetId",datasetId.toString(),"name",name,
            "templateId",plan.templateId(),"mapping",plan.mapping()),actor).get("dashboardId");
        extra.put("method","template");
      } else if(Boolean.FALSE.equals(plan.useTemplate())) {
        List<Map<String,Object>> specs=customSpecs(plan.charts(),datasetId);
        // Validate the complete plan first, then save atomically. Never silently skip a chart.
        for(var spec:specs) charts.preview(spec,null);
        List<String> ids=new ArrayList<>();
        for(var spec:specs) ids.add(charts.save(spec,actor).toString());
        dashboardId=dashboards.save(Map.of("name",name),actor);
        dashboards.layout(dashboardId,Map.of("chartIds",ids),actor);
        extra.put("method","custom");
        extra.put("chart_count",ids.size());
      } else throw Api.bad("AI chưa chọn cách tạo dashboard");
      answer="Đã tạo dashboard \""+name+"\". Các biểu đồ hiển thị ngay bên dưới; mở dashboard đầy đủ để lọc hoặc chỉnh bố cục.";
      extra.put("dashboard_id",dashboardId.toString());
      extra.put("dashboard_name",name);
      result.put("dashboard_id",dashboardId.toString());
    } else if("clarify".equals(plan.intent())) {
      answer=bounded(plan.clarification(),2000,"Câu hỏi làm rõ");
    } else throw Api.bad("AI trả loại yêu cầu không được hỗ trợ");
    extra.put("intent",plan.intent());
    UUID assistantId=UUID.randomUUID();
    try {
      db.update("INSERT INTO chat_messages(id,conversation_id,role,content) VALUES (?,?,'user',?)",UUID.randomUUID(),conversationId,message);
      db.update("INSERT INTO chat_messages(id,conversation_id,role,content,metadata_json) VALUES (?,?,'assistant',?,?)",
          assistantId,conversationId,answer,mapper.writeValueAsString(extra));
    } catch(com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("Cannot save chat result",e); }
    db.update("UPDATE conversations SET updated_at=clock_timestamp() WHERE id=?",conversationId);
    auth.audit(actor,"CHAT_MESSAGE","CONVERSATION",conversationId);
    result.put("message_id",assistantId);
    result.put("intent",plan.intent());
    result.put("answer",answer);
    return result;
  }
  static List<Map<String,Object>> customSpecs(List<Map<String,Object>> proposed,UUID datasetId) {
    if(proposed==null || proposed.size()<2 || proposed.size()>4) throw Api.bad("Dashboard custom cần từ 2 đến 4 biểu đồ");
    List<Map<String,Object>> specs=new ArrayList<>();
    Set<String> allowed=Set.of("name","chartType","dimension","metric","aggregate","timeGrain","seriesDimension","numericColumns","binCount","latitude","longitude","labelColumn");
    for(var raw:proposed) {
      if(raw==null || !allowed.containsAll(raw.keySet())) throw Api.bad("Cấu hình biểu đồ AI không hợp lệ");
      for(var entry:raw.entrySet()){
        Object value=entry.getValue();if(value==null)continue;
        if(entry.getKey().equals("numericColumns")){
          if(!(value instanceof List<?> items) || items.size()<2 || items.size()>8 || items.stream().anyMatch(v->!(v instanceof String)))throw Api.bad("Heatmap cần 2–8 tên cột");
        } else if(entry.getKey().equals("binCount")){
          try{int n=new java.math.BigDecimal(value.toString()).intValueExact();if(n<2 || n>50)throw new IllegalArgumentException();}catch(Exception e){throw Api.bad("Số khoảng phải là số nguyên từ 2 đến 50");}
        } else if(!(value instanceof String))throw Api.bad("Thuộc tính biểu đồ cần chuỗi");
      }
      Map<String,Object> spec=new LinkedHashMap<>(raw);
      spec.put("name",bounded(Api.text(raw,"name"),120,"Tên biểu đồ"));
      spec.put("datasetId",datasetId.toString());
      specs.add(spec);
    }
    return specs;
  }
  /** Answers use executed rows only; AI prose and regex replacements are never used. */
  static String formatAnswer(Map<String,Object> data) {
    @SuppressWarnings("unchecked") List<Map<String,Object>> rows=(List<Map<String,Object>>)data.get("rows");
    if(rows.isEmpty()) return "Không tìm thấy dữ liệu phù hợp.";
    @SuppressWarnings("unchecked") List<String> columns=(List<String>)data.get("columns");
    StringJoiner output=new StringJoiner("\n");
    for(var row:rows) {
      StringJoiner line=new StringJoiner(" · ");
      for(String column:columns) line.add(column+": "+formatValue(row.get(column)));
      output.add(line.toString());
    }
    if(Boolean.TRUE.equals(data.get("truncated"))) output.add("Kết quả đã giới hạn số dòng hiển thị.");
    return output.toString();
  }
  static String formatValue(Object value) {
    if(value==null) return "NULL";
    if(value instanceof BigDecimal number) return number.stripTrailingZeros().toPlainString();
    return value.toString();
  }
  static String bounded(String value,int max,String field) {
    if(value==null || value.isBlank() || value.trim().length()>max) throw Api.bad(field+" cần từ 1 đến "+max+" ký tự");
    return value.trim();
  }
  @Transactional
  public void deleteConversation(UUID id,Auth.Actor actor) {
    auth.canEdit(actor);
    ownedConversation(id,actor);
    db.update("DELETE FROM conversations WHERE id=?",id);
    auth.audit(actor,"DELETE","CONVERSATION",id);
  }
  @RestController @RequestMapping("/api/chat")
  public static class Controller {
    private final Chat service;
    private final Auth auth;
    Controller(Chat service,Auth auth) { this.service=service; this.auth=auth; }
    @GetMapping("/conversations")
    List<Map<String,Object>> list(HttpServletRequest request) { return service.listConversations(auth.actor(request)); }
    @PostMapping("/conversations")
    Map<String,Object> create(@RequestBody Map<String,Object> body,HttpServletRequest request) {
      Auth.Actor actor=auth.actor(request);
      auth.canEdit(actor);
      String title=Api.optional(body,"title");
      return Map.of("id",service.createConversation(Api.uuid(Api.text(body,"datasetId")),title.isEmpty()?"Cuộc hội thoại mới":title,actor));
    }
    @GetMapping("/conversations/{id}")
    Map<String,Object> get(@PathVariable String id,HttpServletRequest request) { return service.getConversation(Api.uuid(id),auth.actor(request)); }
    @PostMapping("/message")
    Map<String,Object> message(@RequestBody Map<String,Object> body,HttpServletRequest request) {
      Auth.Actor actor=auth.actor(request);
      auth.canEdit(actor);
      return service.sendMessage(Api.uuid(Api.text(body,"conversationId")),Api.text(body,"message"),actor);
    }
    @DeleteMapping("/conversations/{id}")
    Map<String,Object> delete(@PathVariable String id,HttpServletRequest request) {
      service.deleteConversation(Api.uuid(id),auth.actor(request));
      return Map.of("success",true);
    }
  }
}
