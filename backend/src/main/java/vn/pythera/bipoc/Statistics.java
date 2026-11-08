package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.time.Duration;
import java.util.*;

/** Read selected real columns in one source snapshot, then execute a trusted statistical engine. */
@Service
public class Statistics {
  private final Datasets datasets; private final DatasetAnalysis analysis; private final Connections connections;
  private final Auth auth; private final ObjectMapper mapper; private final String aiUrl,secret;
  private final HttpClient client=HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
  public Statistics(Datasets datasets,DatasetAnalysis analysis,Connections connections,Auth auth,ObjectMapper mapper,
      @Value("${poc.ai.service.url:http://127.0.0.1:8000}") String aiUrl,
      @Value("${poc.secret.key:local-poc-key-change-before-sharing}") String secret) {
    this.datasets=datasets;this.analysis=analysis;this.connections=connections;this.auth=auth;this.mapper=mapper;this.aiUrl=aiUrl;this.secret=secret;
  }
  record Plan(String operation,Map<String,Object> parameters,List<String> columns) {}
  static final Set<String> METHODS=Set.of("descriptive","correlation","outlier","shapiro_wilk","independent_ttest","paired_ttest","anova","chi_square","mann_whitney","kruskal_wallis");
  static Plan validate(JsonNode config,DatasetAnalysis.Metadata metadata) {
    if(config==null || !config.isObject())throw Api.bad("Cần cấu hình thống kê");
    String op=config.path("operation").asText();if(!METHODS.contains(op))throw Api.bad("Phương pháp thống kê không hỗ trợ");
    Set<String> fields=new HashSet<>(List.of("operation"));
    if(Set.of("descriptive","correlation").contains(op))fields.add("columns");
    if(Set.of("outlier","shapiro_wilk").contains(op))fields.add("column");
    if(Set.of("independent_ttest","anova","mann_whitney","kruskal_wallis").contains(op))fields.addAll(List.of("value_column","group_column","group_values"));
    if(op.equals("paired_ttest"))fields.addAll(List.of("column_before","column_after"));
    if(op.equals("chi_square"))fields.addAll(List.of("column1","column2"));
    if(Set.of("outlier","correlation").contains(op))fields.add("method");
    if(op.equals("outlier"))fields.add("threshold");
    if(op.equals("independent_ttest"))fields.add("equal_variance");
    if(!Set.of("descriptive","correlation","outlier").contains(op))fields.add("alpha");
    var it=config.fieldNames();while(it.hasNext())if(!fields.contains(it.next()))throw Api.bad("Thuộc tính thống kê không hợp lệ");
    Map<String,DatasetAnalysis.Column> known=new LinkedHashMap<>();metadata.columns().forEach(c->known.put(c.name(),c));
    Map<String,Object> p=new LinkedHashMap<>();LinkedHashSet<String> selected=new LinkedHashSet<>();
    if(fields.contains("columns")) {
      var names=config.path("columns");int min=op.equals("correlation")?2:1;
      if(!names.isArray() || names.size()<min || names.size()>10)throw Api.bad("Chọn "+min+"–10 cột số");
      for(var name:names){checkColumn(name,known,true);if(!selected.add(name.asText()))throw Api.bad("Cột không được trùng");}
      p.put("columns",new ArrayList<>(selected));
    }
    for(String key:List.of("column","value_column","group_column","column_before","column_after","column1","column2"))if(fields.contains(key)) {
      JsonNode name=config.path(key);boolean numeric=!Set.of("group_column","column1","column2").contains(key);
      checkColumn(name,known,numeric);selected.add(name.asText());p.put(key,name.asText());
    }
    if(selected.size()>10)throw Api.bad("Tối đa 10 cột cho một phân tích");
    if(op.equals("paired_ttest") && Objects.equals(p.get("column_before"),p.get("column_after")))throw Api.bad("Cần hai cột trước/sau khác nhau");
    if(op.equals("chi_square") && Objects.equals(p.get("column1"),p.get("column2")))throw Api.bad("Cần hai biến phân loại khác nhau");
    if(config.has("method")) {
      String method=config.path("method").asText();Set<String> allowed=op.equals("correlation")?Set.of("pearson","spearman"):Set.of("iqr","zscore");
      if(!allowed.contains(method))throw Api.bad("Phương pháp không hợp lệ");p.put("method",method);
    }
    for(String key:List.of("threshold","alpha"))if(config.has(key)) {
      var n=config.get(key);if(!n.isNumber() || !Double.isFinite(n.asDouble()) || n.asDouble()<=0 || n.asDouble()>(key.equals("alpha")?0.1:100) || (key.equals("alpha") && n.asDouble()<0.01))throw Api.bad("Ngưỡng thống kê ngoài phạm vi");
      p.put(key,n.asDouble());
    }
    if(config.has("equal_variance")){if(!config.get("equal_variance").isBoolean())throw Api.bad("equal_variance phải là boolean");p.put("equal_variance",config.get("equal_variance").asBoolean());}
    if(config.has("group_values")) {
      var values=config.get("group_values");if(!values.isArray() || values.size()<2 || values.size()>50)throw Api.bad("Chọn 2–50 giá trị nhóm");
      List<Object> groups=new ArrayList<>();for(var v:values){if(!(v.isTextual() || v.isNumber() || v.isBoolean()) || v.asText().length()>500)throw Api.bad("Giá trị nhóm không hợp lệ");groups.add(v.isTextual()?v.asText():v.isBoolean()?v.asBoolean():v.numberValue());}p.put("group_values",groups);
    }
    return new Plan(op,p,new ArrayList<>(selected));
  }
  private static void checkColumn(JsonNode name,Map<String,DatasetAnalysis.Column> known,boolean numeric) {
    if(!name.isTextual() || !known.containsKey(name.asText()))throw Api.bad("Cột không có trong dataset");
    var col=known.get(name.asText());if(numeric && !col.kind().equals("number"))throw Api.bad("Phân tích cần cột số");
    if(!numeric && col.kind().equals("other"))throw Api.bad("Kiểu cột không hỗ trợ phân nhóm");
  }
  static String quoted(String name){return "\""+name.replace("\"","\"\"")+"\"";}
  public Map<String,Object> execute(UUID id,JsonNode config,Auth.Actor actor) {
    auth.canEdit(actor);Plan plan=validate(config,analysis.metadata(id));var dataset=datasets.get(id);
    List<List<Object>> data=new ArrayList<>();
    String projection=String.join(",",plan.columns().stream().map(Statistics::quoted).toList());
    try(Connection c=connections.open((UUID)dataset.get("connection_id"))) {
      c.setReadOnly(true);c.setAutoCommit(false);c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
      try(PreparedStatement st=c.prepareStatement("SELECT "+projection+" FROM "+datasets.source(dataset)+" LIMIT 1000001")) {
        st.setQueryTimeout(30);st.setFetchSize(5000);long cells=0;
        try(ResultSet rs=st.executeQuery()) {
          while(rs.next()) {
            if(data.size()>=1_000_000)throw new Api.Failure(422,"Engine hỗ trợ tối đa 1.000.000 dòng; không tự lấy mẫu");
            List<Object> row=new ArrayList<>();for(int i=1;i<=plan.columns().size();i++) {
              Object v=rs.getObject(i);
              if(v instanceof Number n){double d=n.doubleValue();row.add(Double.isFinite(d)?v:null);}
              else if(v==null || v instanceof Boolean)row.add(v);
              else {String text=v.toString();cells+=text.length();if(text.length()>10000 || cells>40_000_000)throw new Api.Failure(422,"Dữ liệu văn bản vượt giới hạn engine");row.add(text);}
            }data.add(row);
          }
        }
      }c.rollback();
    }catch(SQLException e){throw new Api.Failure("57014".equals(e.getSQLState())?504:400,"Không đọc được dữ liệu thống kê; kiểm tra nguồn hoặc thời gian truy vấn");}
    Map<String,Object> body=Map.of("dataset_id",id.toString(),"operation",plan.operation(),"parameters",plan.parameters(),"columns",plan.columns(),"data",data);
    try {
      byte[] json=mapper.writeValueAsBytes(body);if(json.length>100_000_000)throw new Api.Failure(422,"Dữ liệu vượt giới hạn 100 MB của lượt phân tích");
      HttpRequest req=HttpRequest.newBuilder(URI.create(aiUrl+"/internal/statistics")).timeout(Duration.ofSeconds(60))
          .header("Content-Type","application/json").header("X-POC-Internal-Key",secret).POST(HttpRequest.BodyPublishers.ofByteArray(json)).build();
      var response=client.send(req,HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
      if(response.statusCode()!=200) {
        if(response.statusCode()==400){String message=mapper.readTree(response.body()).path("detail").asText("Không đủ điều kiện phân tích");throw Api.bad(message.substring(0,Math.min(500,message.length())));}
        throw new Api.Failure(502,"Engine thống kê chưa sẵn sàng; kiểm tra dịch vụ Python và khóa nội bộ");
      }
      if(response.body().length()>2_000_000)throw new Api.Failure(502,"Kết quả thống kê vượt giới hạn");
      JsonNode node=mapper.readTree(response.body());
      if(node.path("schemaVersion").asInt()!=1 || !id.toString().equals(node.path("datasetId").asText()))throw new Api.Failure(502,"Kết quả engine không khớp dataset");
      @SuppressWarnings("unchecked") Map<String,Object> result=mapper.convertValue(node,Map.class);
      auth.audit(actor,"STATISTICS","DATASET",id);return result;
    }catch(Api.Failure e){throw e;}catch(InterruptedException e){Thread.currentThread().interrupt();throw new Api.Failure(503,"Lượt phân tích bị gián đoạn");}
    catch(java.net.http.HttpTimeoutException e){throw new Api.Failure(504,"Engine phản hồi quá lâu");}
    catch(java.io.IOException|IllegalArgumentException e){throw new Api.Failure(502,"Không nhận được kết quả từ engine thống kê");}
  }
  @RestController @RequestMapping("/api/datasets")
  public static class Controller {
    private final Statistics service;private final Auth auth;
    Controller(Statistics service,Auth auth){this.service=service;this.auth=auth;}
    @PostMapping("/{id}/statistics") Map<String,Object> run(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest request){return service.execute(Api.uuid(id),body,auth.actor(request));}
  }
}
