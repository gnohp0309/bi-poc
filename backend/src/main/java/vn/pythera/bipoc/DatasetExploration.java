package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.sql.*;
import java.time.Instant;
import java.util.*;

/** Read-only dataset report. All source queries share one snapshot and a bounded deadline. */
@Service
public class DatasetExploration {
  private final Datasets datasets;
  private final Connections connections;
  private final DatasetAnalysis analysis;
  private final JdbcTemplate db;
  public DatasetExploration(Datasets datasets, Connections connections, DatasetAnalysis analysis, JdbcTemplate db) {
    this.datasets=datasets; this.connections=connections; this.analysis=analysis; this.db=db;
  }
  private static String quote(String name) { return "\""+name.replace("\"","\"\"")+"\""; }
  private static String present(DatasetAnalysis.Column col) {
    String x=quote(col.name());
    return x+" IS NOT NULL"+(col.kind().equals("text")?" AND btrim("+x+") <> ''":"");
  }
  private static String valid(DatasetAnalysis.Column col) {
    return present(col)+(col.kind().equals("number")?" AND "+quote(col.name())+"::text NOT IN ('NaN','Infinity','-Infinity')":"");
  }
  private static List<Map<String,Object>> query(Connection c, String sql, long deadline) throws SQLException {
    long remaining=deadline-System.nanoTime();
    if(remaining<=0) throw new SQLTimeoutException();
    try(PreparedStatement st=c.prepareStatement(sql)) {
      st.setQueryTimeout((int)Math.max(1,Math.min(6,(remaining+999_999_999L)/1_000_000_000L)));
      try(ResultSet rs=st.executeQuery()) {
        List<Map<String,Object>> rows=new ArrayList<>(); var meta=rs.getMetaData();
        while(rs.next()) {
          Map<String,Object> row=new LinkedHashMap<>();
          for(int i=1;i<=meta.getColumnCount();i++) row.put(meta.getColumnLabel(i),rs.getObject(i));
          rows.add(row);
        }
        return rows;
      }
    }
  }
  public Map<String,Object> report(UUID id) {
    var dataset=datasets.get(id);
    var metadata=analysis.metadata(id);
    List<Map<String,Object>> imports=db.queryForList("SELECT row_count,missing_count,invalid_count,columns_json,created_at FROM file_imports WHERE dataset_id=?",id);
    boolean imported=!imports.isEmpty();
    Map<String,com.fasterxml.jackson.databind.JsonNode> importColumns=new HashMap<>();
    if(imported)try {
      var saved=new com.fasterxml.jackson.databind.ObjectMapper().readTree(imports.get(0).get("columns_json").toString());
      for(var item:saved)importColumns.put(item.path("name").asText(),item);
    }catch(java.io.IOException e){throw new IllegalStateException("Invalid stored import quality",e);}
    var columns=metadata.columns().stream().filter(col->!imported || !Set.of("row_id","record_group").contains(col.name())).toList();
    if(columns.size()>128) throw new Api.Failure(422,"Báo cáo hiện hỗ trợ tối đa 128 cột; hãy tạo dataset chỉ gồm các cột cần khám phá");
    String source=datasets.source(dataset);
    long deadline=System.nanoTime()+30_000_000_000L;
    try(Connection c=connections.open((UUID)dataset.get("connection_id"))) {
      c.setReadOnly(true); c.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ); c.setAutoCommit(false);
      try(Statement tx=c.createStatement()){tx.execute("SET TRANSACTION READ ONLY");}
      var overview=query(c,"SELECT count(*) AS \"rowCount\", coalesce(sum(pg_column_size(src)),0) AS \"sizeBytes\" FROM (SELECT * FROM "+source+") src",deadline).get(0);
      long rowCount=((Number)overview.get("rowCount")).longValue();
      overview.put("columnCount",columns.size());
      overview.put("sizeDescription","Dung lượng logic của các dòng PostgreSQL, không phải kích thước file hay dung lượng đĩa");
      List<Map<String,Object>> profiles=new ArrayList<>(); List<String> warnings=new ArrayList<>();
      long missingCells=0,invalidCells=0;
      for(var col:columns) {
        String x=quote(col.name()),ok=valid(col),exists=present(col);
        String distinct=col.kind().equals("other")?x+"::text":x;
        String select="SELECT count(*) FILTER (WHERE "+x+" IS NULL) AS \"nullCount\", "+
            "count(*) FILTER (WHERE "+exists+") AS \"presentCount\", "+
            "count(*) FILTER (WHERE "+ok+") AS \"validCount\", "+
            "count(DISTINCT "+distinct+") FILTER (WHERE "+ok+") AS \"distinctCount\"";
        boolean numeric=col.kind().equals("number");
        if(numeric) select+=", min("+x+") FILTER (WHERE "+ok+") AS min, max("+x+") FILTER (WHERE "+ok+") AS max, "+
            "avg("+x+") FILTER (WHERE "+ok+") AS mean, "+
            "stddev_samp("+x+") FILTER (WHERE "+ok+") AS \"standardDeviation\", "+
            "var_samp("+x+") FILTER (WHERE "+ok+") AS variance, "+
            "percentile_cont(0.25) WITHIN GROUP (ORDER BY "+x+") FILTER (WHERE "+ok+") AS q1, "+
            "percentile_cont(0.5) WITHIN GROUP (ORDER BY "+x+") FILTER (WHERE "+ok+") AS median, "+
            "percentile_cont(0.75) WITHIN GROUP (ORDER BY "+x+") FILTER (WHERE "+ok+") AS q3";
        else if(col.kind().equals("date")) select+=", min("+x+") AS min, max("+x+") AS max";
        var profile=query(c,select+" FROM "+source,deadline).get(0);
        long present=((Number)profile.remove("presentCount")).longValue();
        long valid=((Number)profile.get("validCount")).longValue();
        long missing=rowCount-present,invalid=present-valid;
        profile.put("name",col.name());profile.put("label",col.label());profile.put("type",col.type());profile.put("kind",col.kind());
        profile.put("missingCount",missing);profile.put("blankCount",rowCount-present-((Number)profile.get("nullCount")).longValue());
        profile.put("invalidCount",invalid);profile.put("missingRate",rowCount==0?null:100.0*missing/rowCount);
        if(importColumns.containsKey(col.name())) {
          var original=importColumns.get(col.name());
          profile.put("importMissingCount",original.path("missing").asLong());
          profile.put("importInvalidCount",original.path("invalid").asLong());
          List<String> examples=new ArrayList<>();for(var example:original.path("invalidExamples"))examples.add(example.asText());
          profile.put("importInvalidExamples",examples);
        }
        profile.put("statisticsAvailable",numeric);
        profile.put("statisticsNote",numeric?"Bỏ qua giá trị thiếu/không hữu hạn. Độ lệch chuẩn và phương sai mẫu cần ít nhất 2 giá trị; quartile nội suy bằng số thực.":"Thống kê số không áp dụng cho kiểu cột này.");
        // Bound the result, never the source population. JSON keeps JDBC-only types out of responses.
        var top=query(c,"SELECT left("+distinct+"::text,200) AS value, count(*) AS frequency FROM "+source+
            " WHERE "+ok+" GROUP BY "+distinct+" ORDER BY count(*) DESC, "+distinct+"::text ASC LIMIT 10",deadline);
        profile.put("topValues",top);profile.put("topValuesTruncated",((Number)profile.get("distinctCount")).longValue()>10);
        profile.put("mode",top.isEmpty()?null:top.get(0).get("value"));
        profile.put("modeNote","Giá trị xuất hiện nhiều nhất; nếu đồng hạng, chọn theo thứ tự văn bản tăng dần. Nhãn dài được rút còn 200 ký tự.");
        profiles.add(profile);missingCells+=missing;invalidCells+=invalid;
      }
      String projection=String.join(",",columns.stream().map(col->quote(col.name())).toList());
      // Generated CSV row IDs are deliberately excluded from duplicate identity.
      long duplicates=columns.isEmpty()?0:((Number)query(c,"SELECT coalesce(sum(n-1),0) AS n FROM (SELECT count(*) n FROM (SELECT "+projection+
          " FROM "+source+") vals GROUP BY to_jsonb(vals) HAVING count(*)>1) groups",deadline).get(0).get("n")).longValue();
      var quality=new LinkedHashMap<String,Object>();
      quality.put("missingCells",missingCells);quality.put("invalidCells",invalidCells);quality.put("duplicateRows",duplicates);
      quality.put("duplicateDescription","Số dòng dư sau lần xuất hiện đầu tiên, so trên toàn bộ cột dữ liệu; không gồm row_id/record_group tự sinh khi import CSV");
      quality.put("rules",List.of("Thiếu: NULL hoặc chuỗi rỗng sau khi bỏ khoảng trắng ở hai đầu", "Không hợp lệ: NaN/Infinity/-Infinity trong cột số", "Trùng: các cột dữ liệu có cùng giá trị"));
      warnings.add("Chưa có quy tắc nghiệp vụ tùy chỉnh; báo cáo không tự kết luận email, số điện thoại hay giá trị âm là sai.");
      warnings.add("Phân phối hiển thị tối đa 10 giá trị phổ biến mỗi cột; mọi tần suất và thống kê đều tính trên toàn bộ dataset.");
      if(imported) {
        var snapshot=new LinkedHashMap<>(imports.get(0));snapshot.remove("columns_json");
        quality.put("importSnapshot",snapshot);
        warnings.add("Thống kê lỗi CSV là ảnh chụp lúc nhập. Ô sai kiểu đã chuyển NULL, không thể khôi phục nguyên nhân từ NULL hiện tại. Dung lượng logic gồm cả cột hệ thống CSV.");
      }
      overview.put("missingRate",rowCount==0 || columns.isEmpty()?null:100.0*missingCells/((double)rowCount*columns.size()));
      c.rollback();
      Map<String,Object> result=new LinkedHashMap<>();
      result.put("datasetId",id);result.put("name",metadata.name());result.put("kind",metadata.kind());
      result.put("generatedAt",Instant.now().toString());result.put("scope","full-dataset");result.put("sampled",false);
      result.put("overview",overview);result.put("columns",profiles);result.put("quality",quality);result.put("warnings",warnings);
      return result;
    } catch(SQLException e) {
      if(e instanceof SQLTimeoutException || "57014".equals(e.getSQLState())) throw new Api.Failure(504,"Phân tích vượt thời gian cho phép; hãy thu hẹp dataset hoặc thử lại");
      throw Api.bad("Không tạo được báo cáo khám phá; kiểm tra nguồn, kiểu dữ liệu và định nghĩa dataset");
    }
  }
  @RestController @RequestMapping("/api/datasets")
  public static class Controller {
    private final DatasetExploration service; private final Auth auth;
    Controller(DatasetExploration service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping("/{id}/exploration") Map<String,Object> report(@PathVariable String id,HttpServletRequest request){
      auth.actor(request);return service.report(Api.uuid(id));
    }
  }
}
