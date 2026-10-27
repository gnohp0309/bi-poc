package vn.pythera.bipoc;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVParser;
import org.apache.commons.csv.CSVRecord;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PushbackInputStream;
import java.math.BigDecimal;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.sql.Types;
import java.text.Normalizer;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.*;

@Service
public class CsvImports {
  private static final long MAX_BYTES = 200L * 1024 * 1024;
  private static final long MAX_ROWS = 1_000_000;
  private static final int MAX_COLUMNS = 32;
  private static final int BATCH_SIZE = 1_000;
  private final JdbcTemplate db;
  private final Auth auth;
  private final Connections connections;
  private final Datasets datasets;
  private final Charts charts;
  private final Dashboards dashboards;
  private final ObjectMapper mapper;
  private final String readerPassword;

  CsvImports(JdbcTemplate db, Auth auth, Connections connections, Datasets datasets,
      Charts charts, Dashboards dashboards, ObjectMapper mapper,
      @Value("${poc.upload.reader.password}") String readerPassword) {
    this.db=db;this.auth=auth;this.connections=connections;this.datasets=datasets;
    this.charts=charts;this.dashboards=dashboards;this.mapper=mapper;this.readerPassword=readerPassword;
  }

  private enum Kind { TEXT, NUMERIC, DATE }

  private static class Column {
    String original;
    String name;
    Kind kind=Kind.TEXT;
    long missing=0;
    long invalid=0;
    long numericCount=0;
    BigDecimal sum=BigDecimal.ZERO;
    BigDecimal min;
    BigDecimal max;
    final List<String> invalidExamples=new ArrayList<>();
    Column(String original,String name){this.original=original;this.name=name;}
    Map<String,Object> describe(){
      Map<String,Object> out=new LinkedHashMap<>();
      out.put("original",original);out.put("name",name);out.put("type",kind.name());
      out.put("missing",missing);out.put("invalid",invalid);
      out.put("invalidExamples",invalidExamples);
      if(kind==Kind.NUMERIC){
        out.put("validCount",numericCount);out.put("sum",sum);
        out.put("average",numericCount==0?null:sum.divide(BigDecimal.valueOf(numericCount),2,java.math.RoundingMode.HALF_UP));
        out.put("min",min);out.put("max",max);
      }
      return out;
    }
  }

  private CSVParser parser(MultipartFile file) throws IOException {
    PushbackInputStream in=new PushbackInputStream(file.getInputStream(),3);
    byte[] prefix=in.readNBytes(3);
    if(prefix.length!=3 || (prefix[0]&255)!=0xef || (prefix[1]&255)!=0xbb || (prefix[2]&255)!=0xbf)
      in.unread(prefix);
    InputStreamReader reader=new InputStreamReader(in,StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT));
    return CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true)
        .setIgnoreEmptyLines(true).get().parse(reader);
  }

  private static String sqlName(String header,int index,Set<String> used){
    String normalized=Normalizer.normalize(header,Normalizer.Form.NFD).replaceAll("\\p{M}","")
        .replace('đ','d').replace('Đ','D').toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+","_")
        .replaceAll("^_+|_+$","");
    if(normalized.isBlank()) normalized="column_"+index;
    if(normalized.length()>45) normalized=normalized.substring(0,45);
    String base="c_"+normalized;String candidate=base;int suffix=2;
    while(!used.add(candidate)) candidate=base+"_"+suffix++;
    return candidate;
  }

  private static BigDecimal number(String value){
    if(!value.matches("[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?")) return null;
    try {
      BigDecimal n=new BigDecimal(value);
      return n.precision()<=24 && Math.abs(n.scale())<=12?n:null;
    } catch(NumberFormatException e){return null;}
  }
  private static LocalDate date(String value){
    try{return LocalDate.parse(value);}catch(DateTimeParseException e){return null;}
  }
  private static void width(CSVRecord record,int expected){
    if(record.size()!=expected) throw Api.bad("Dòng CSV "+record.getRecordNumber()+" có "+record.size()+" cột; cần "+expected);
  }

  private List<Column> inspect(MultipartFile file) throws IOException {
    try(CSVParser csv=parser(file)){
      List<String> headers=csv.getHeaderNames();
      if(headers.isEmpty() || headers.size()>MAX_COLUMNS) throw Api.bad("CSV cần từ 1 đến 32 cột có tiêu đề");
      Set<String> used=new HashSet<>();List<Column> columns=new ArrayList<>();int index=1;
      for(String header:headers){
        if(header==null || header.isBlank() || header.length()>128) throw Api.bad("Tiêu đề cột trống hoặc quá dài");
        columns.add(new Column(header.trim(),sqlName(header,index++,used)));
      }
      int[] nonempty=new int[columns.size()],numeric=new int[columns.size()],dates=new int[columns.size()];
      int sampled=0;
      for(CSVRecord record:csv){
        width(record,columns.size());sampled++;
        for(int i=0;i<columns.size();i++){
          String value=record.get(i).trim();if(value.isEmpty()) continue;
          nonempty[i]++;
          if(number(value)!=null) numeric[i]++;
          if(date(value)!=null) dates[i]++;
        }
        if(sampled>=200) break;
      }
      if(sampled==0) throw Api.bad("CSV chưa có dòng dữ liệu");
      for(int i=0;i<columns.size();i++){
        if(nonempty[i]>0 && numeric[i]*10>=nonempty[i]*7) columns.get(i).kind=Kind.NUMERIC;
        else if(nonempty[i]>0 && dates[i]*10>=nonempty[i]*7) columns.get(i).kind=Kind.DATE;
      }
      return columns;
    }
  }

  private static String tableSql(String table){return "uploads."+Queries.identifier(table);}
  private static String quoted(String value){return Queries.identifier(value);}
  private void createTable(String table,List<Column> columns){
    StringBuilder sql=new StringBuilder("CREATE TABLE ").append(tableSql(table))
        .append(" (row_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, record_group TEXT NOT NULL");
    for(Column column:columns){
      sql.append(',').append(quoted(column.name)).append(' ').append(switch(column.kind){
        case TEXT -> "TEXT";case NUMERIC -> "NUMERIC";case DATE -> "DATE";
      });
    }
    db.execute(sql.append(')').toString());
    db.execute("GRANT SELECT ON "+tableSql(table)+" TO bi_reader");
  }

  private long insertRows(MultipartFile file,String table,List<Column> columns) throws IOException {
    String names="record_group";
    for(Column column:columns) names+=","+quoted(column.name);
    String placeholders=String.join(",",Collections.nCopies(columns.size()+1,"?"));
    String sql="INSERT INTO "+tableSql(table)+" ("+names+") VALUES ("+placeholders+")";
    int[] types=new int[columns.size()+1];types[0]=Types.VARCHAR;
    for(int i=0;i<columns.size();i++) types[i+1]=switch(columns.get(i).kind){
      case TEXT -> Types.VARCHAR;case NUMERIC -> Types.NUMERIC;case DATE -> Types.DATE;
    };
    List<Object[]> batch=new ArrayList<>(BATCH_SIZE);long count=0;
    try(CSVParser csv=parser(file)){
      if(csv.getHeaderNames().size()!=columns.size()) throw Api.bad("Tiêu đề CSV đã thay đổi khi đọc file");
      for(CSVRecord record:csv){
        width(record,columns.size());
        if(++count>MAX_ROWS) throw Api.bad("CSV vượt giới hạn 1.000.000 dòng của POC");
        Object[] values=new Object[columns.size()+1];values[0]="Toàn bộ";
        for(int i=0;i<columns.size();i++){
          Column column=columns.get(i);String raw=record.get(i).trim();
          if(raw.isBlank()){column.missing++;values[i+1]=null;continue;}
          Object value=switch(column.kind){
            case TEXT -> raw;
            case NUMERIC -> number(raw);
            case DATE -> date(raw);
          };
          if(value==null){
            column.invalid++;
            if(column.invalidExamples.size()<3) column.invalidExamples.add("dòng "+record.getRecordNumber()+": "+raw.substring(0,Math.min(raw.length(),60)));
          } else if(value instanceof BigDecimal n){
            column.numericCount++;column.sum=column.sum.add(n);
            column.min=column.min==null?n:column.min.min(n);
            column.max=column.max==null?n:column.max.max(n);
          }
          values[i+1]=value;
        }
        batch.add(values);
        if(batch.size()>=BATCH_SIZE){db.batchUpdate(sql,batch,types);batch.clear();}
      }
      if(!batch.isEmpty()) db.batchUpdate(sql,batch,types);
    }
    if(count==0) throw Api.bad("CSV chưa có dòng dữ liệu");
    return count;
  }

  private UUID uploadConnection(Auth.Actor actor){
    List<UUID> matches=db.query("SELECT id FROM db_connections WHERE name='CSV imports (read-only)' AND database_name='bi_poc_app' AND username='bi_reader' ORDER BY created_at LIMIT 1",
        (rs,n)->rs.getObject(1,UUID.class));
    if(!matches.isEmpty()) return matches.get(0);
    return connections.save(Map.of("name","CSV imports (read-only)","host","127.0.0.1","port",5433,
        "database","bi_poc_app","username","bi_reader","password",readerPassword),actor);
  }

  private UUID chart(UUID datasetId,String name,String type,String dimension,String metric,String aggregate,Auth.Actor actor){
    return charts.save(Map.of("datasetId",datasetId.toString(),"name",name,"chartType",type,
        "dimension",dimension,"metric",metric,"aggregate",aggregate),actor);
  }

  private void generateCharts(UUID datasetId,String table,List<Column> columns,String title,Auth.Actor actor,
      List<UUID> ids,UUID[] monthDatasetId){
    List<Column> textColumns=columns.stream().filter(c->c.kind==Kind.TEXT && c.missing<MAX_ROWS).toList();
    List<Column> numberColumns=columns.stream().filter(c->c.kind==Kind.NUMERIC && c.numericCount>0).toList();
    List<Column> dateColumns=columns.stream().filter(c->c.kind==Kind.DATE).toList();
    String metric=numberColumns.isEmpty()?"*":numberColumns.get(0).name;
    String aggregate=numberColumns.isEmpty()?"count":"sum";
    String suffix=numberColumns.isEmpty()?"Số dòng":"Tổng "+numberColumns.get(0).original;
    if(!textColumns.isEmpty()){
      ids.add(chart(datasetId,suffix+" theo "+textColumns.get(0).original,"bar",textColumns.get(0).name,metric,aggregate,actor));
      if(textColumns.size()>1) ids.add(chart(datasetId,suffix+" theo "+textColumns.get(1).original,"pie",textColumns.get(1).name,metric,aggregate,actor));
    } else ids.add(chart(datasetId,"Tổng số dòng","bar","record_group","*","count",actor));
    if(!dateColumns.isEmpty()){
      Column date=dateColumns.get(0);
      String sql="SELECT to_char("+quoted(date.name)+",'YYYY-MM') AS month"+
          (numberColumns.isEmpty()?"":","+quoted(numberColumns.get(0).name))+" FROM "+tableSql(table)+
          " WHERE "+quoted(date.name)+" IS NOT NULL";
      UUID monthDataset=datasets.save(Map.of("connectionId",datasets.get(datasetId).get("connection_id").toString(),
          "kind","VIRTUAL","name",title+" · Theo tháng","sql",sql),actor);
      monthDatasetId[0]=monthDataset;
      ids.add(chart(monthDataset,suffix+" theo tháng","line","month",metric,aggregate,actor));
    }
  }

  private static String fileName(MultipartFile file){
    String raw=Objects.toString(file.getOriginalFilename(),"data.csv").replace('\\','/');
    String name=raw.substring(raw.lastIndexOf('/')+1).trim();
    return name.length()>255?name.substring(0,255):name;
  }

  public Map<String,Object> upload(MultipartFile file,String requestedTitle,Auth.Actor actor){
    auth.canEdit(actor);
    String name=fileName(file);
    if(!name.toLowerCase(Locale.ROOT).endsWith(".csv")) throw Api.bad("POC hiện chỉ nhận file .csv UTF-8");
    if(file.isEmpty() || file.getSize()>MAX_BYTES) throw Api.bad("CSV phải có dữ liệu và không vượt 200 MB");
    String title=requestedTitle==null || requestedTitle.isBlank()?name.replaceFirst("(?i)\\.csv$",""):requestedTitle.trim();
    if(title.length()>120) throw Api.bad("Tên phân tích không được quá 120 ký tự");
    List<Column> columns;
    try{columns=inspect(file);}catch(IOException e){throw Api.bad("Không đọc được CSV UTF-8: "+e.getMessage());}
    UUID importId=UUID.randomUUID();String table="csv_"+importId.toString().replace("-","");
    UUID dashboardId=null;UUID datasetId=null;boolean tableCreated=false;
    UUID[] monthDatasetId=new UUID[1];List<UUID> chartIds=new ArrayList<>();
    try{
      createTable(table,columns);tableCreated=true;
      long rows=insertRows(file,table,columns);
      UUID connectionId=uploadConnection(actor);
      datasetId=datasets.save(Map.of("connectionId",connectionId.toString(),"kind","PHYSICAL",
          "name",title+" · Dữ liệu CSV","sourceName","uploads."+table),actor);
      Map<String,String> aliases=new LinkedHashMap<>();
      for(Column column:columns) aliases.put(column.name,column.original);
      datasets.aliases(datasetId,Map.of("aliases",aliases),actor);
      generateCharts(datasetId,table,columns,title,actor,chartIds,monthDatasetId);
      dashboardId=dashboards.save(Map.of("name",title+" · Dashboard"),actor);
      dashboards.layout(dashboardId,Map.of("chartIds",chartIds.stream().map(UUID::toString).toList()),actor);
      long missing=columns.stream().mapToLong(c->c.missing).sum();
      long invalid=columns.stream().mapToLong(c->c.invalid).sum();
      List<Map<String,Object>> descriptions=columns.stream().map(Column::describe).toList();
      Map<String,Object> analysis=Map.of("rowCount",rows,"missingCells",missing,"invalidCells",invalid,
          "chartCount",chartIds.size(),"cleaningRule","Trim khoảng trắng; ô trống/sai kiểu thành NULL, không bỏ dòng");
      db.update("INSERT INTO file_imports(id,file_name,table_name,row_count,missing_count,invalid_count,columns_json,analysis_json,dataset_id,month_dataset_id,dashboard_id,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          importId,name,table,rows,missing,invalid,mapper.writeValueAsString(descriptions),mapper.writeValueAsString(analysis),datasetId,monthDatasetId[0],dashboardId,actor.id());
      auth.audit(actor,"IMPORT","FILE",importId);
      return detail(importId);
    }catch(Exception e){
      if(dashboardId!=null) db.update("DELETE FROM dashboards WHERE id=?",dashboardId);
      for(UUID chartId:chartIds) db.update("DELETE FROM charts WHERE id=?",chartId);
      if(monthDatasetId[0]!=null) db.update("DELETE FROM datasets WHERE id=?",monthDatasetId[0]);
      if(datasetId!=null) db.update("DELETE FROM datasets WHERE id=?",datasetId);
      if(tableCreated) db.execute("DROP TABLE IF EXISTS "+tableSql(table));
      if(e instanceof Api.Failure failure) throw failure;
      if(e instanceof IOException) throw Api.bad("CSV không hợp lệ hoặc không phải UTF-8: "+e.getMessage());
      throw Api.bad("Không nhập được CSV: "+e.getMessage());
    }
  }

  public List<Map<String,Object>> list(){
    return db.queryForList("SELECT id,file_name,row_count,missing_count,invalid_count,dataset_id,dashboard_id,created_at FROM file_imports ORDER BY created_at DESC LIMIT 50");
  }
  public Map<String,Object> detail(UUID id){
    List<Map<String,Object>> records=db.queryForList("SELECT id,file_name,table_name,row_count,missing_count,invalid_count,columns_json,analysis_json,dataset_id,month_dataset_id,dashboard_id,created_at FROM file_imports WHERE id=?",id);
    if(records.isEmpty()) throw Api.notFound();
    Map<String,Object> result=new LinkedHashMap<>(records.get(0));
    try{
      result.put("columns",mapper.readValue(result.remove("columns_json").toString(),List.class));
      result.put("analysis",mapper.readValue(result.remove("analysis_json").toString(),Map.class));
    }catch(JsonProcessingException e){throw new IllegalStateException("Import metadata is invalid",e);}
    return result;
  }

  @Transactional
  public void delete(UUID id,Auth.Actor actor){
    auth.canEdit(actor);
    Map<String,Object> item=detail(id);
    db.update("DELETE FROM file_imports WHERE id=?",id);
    db.update("DELETE FROM dashboards WHERE id=?",item.get("dashboard_id"));
    if(item.get("month_dataset_id")!=null) db.update("DELETE FROM datasets WHERE id=?",item.get("month_dataset_id"));
    db.update("DELETE FROM datasets WHERE id=?",item.get("dataset_id"));
    db.execute("DROP TABLE "+tableSql(item.get("table_name").toString()));
    auth.audit(actor,"DELETE","FILE",id);
  }

  @RestController @RequestMapping("/api/imports")
  public static class Controller {
    private final CsvImports service;private final Auth auth;
    Controller(CsvImports service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping List<Map<String,Object>> list(HttpServletRequest request){auth.actor(request);return service.list();}
    @GetMapping("/{id}") Map<String,Object> detail(@PathVariable String id,HttpServletRequest request){auth.actor(request);return service.detail(Api.uuid(id));}
    @PostMapping(consumes="multipart/form-data") Map<String,Object> upload(@RequestParam("file") MultipartFile file,
        @RequestParam(required=false) String title,HttpServletRequest request){return service.upload(file,title,auth.actor(request));}
    @DeleteMapping("/{id}") Map<String,Boolean> delete(@PathVariable String id,HttpServletRequest request){
      service.delete(Api.uuid(id),auth.actor(request));return Map.of("ok",true);
    }
  }
}
