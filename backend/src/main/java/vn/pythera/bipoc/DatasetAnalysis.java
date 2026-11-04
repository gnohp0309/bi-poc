package vn.pythera.bipoc;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.sql.*;
import java.time.*;
import java.util.*;

/** Dataset-scoped, structured analysis. Caller-supplied SQL is never accepted here. */
@Service
public class DatasetAnalysis {
  static final int MAX_GROUPS=3, MAX_METRICS=5, MAX_FILTERS=10, MAX_LIMIT=500;
  static final List<String> AGGREGATES=List.of("sum","avg","min","max","count","count_distinct");
  static final List<String> GRAINS=List.of("day","month","year");
  static final List<String> OPERATORS=List.of("eq","ne","gt","gte","lt","lte","in","is_null","is_not_null");
  private final Datasets datasets;
  private final Connections connections;
  private final Queries queries;
  private final Auth auth;
  private final ObjectMapper mapper;
  private final ObjectReader reader;

  public record Column(String name,String label,String type,String kind,boolean nullable,
      List<String> aggregates,List<String> timeGrains,@JsonIgnore int jdbcType) {}
  public record Metadata(UUID datasetId,String name,String kind,List<Column> columns,Map<String,Object> limits) {}
  public record Group(String column,String timeGrain,String alias) {}
  public record Metric(String column,String aggregate,String alias) {}
  public record Filter(String column,String operator,JsonNode value) {}
  public record Order(String column,String direction) {}
  public record Request(List<Group> groupBy,List<Metric> metrics,List<Filter> filters,List<Order> orderBy,Integer limit) {}
  record Plan(String sql,List<Object> parameters,int limit) {}

  DatasetAnalysis(Datasets datasets,Connections connections,Queries queries,Auth auth,ObjectMapper mapper){
    this.datasets=datasets;this.connections=connections;this.queries=queries;this.auth=auth;
    this.mapper=mapper;this.reader=requestReader(mapper);
  }
  static ObjectReader requestReader(ObjectMapper mapper){
    return mapper.readerFor(Request.class).with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .without(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
  }
  public Metadata metadata(UUID datasetId){
    return inspect(datasetId,datasets.get(datasetId));
  }
  private Metadata inspect(UUID datasetId,Map<String,Object> dataset){
    Map<String,String> aliases=new HashMap<>();
    try {
      JsonNode saved=mapper.readTree(dataset.get("aliases_json").toString());
      if(saved.isObject()) saved.properties().forEach(e->{if(e.getValue().isTextual()) aliases.put(e.getKey(),e.getValue().textValue());});
    }catch(JsonProcessingException e){throw Api.bad("Nhãn cột của dataset không hợp lệ");}
    try(Connection c=connections.open((UUID)dataset.get("connection_id"))){
      c.setReadOnly(true);c.setAutoCommit(false);
      try(Statement tx=c.createStatement()){tx.execute("SET TRANSACTION READ ONLY");}
      try(PreparedStatement st=c.prepareStatement("SELECT * FROM "+datasets.source(dataset)+" LIMIT 0")){
        st.setQueryTimeout(6);
        try(ResultSet rs=st.executeQuery()){
          ResultSetMetaData meta=rs.getMetaData();List<Column> columns=new ArrayList<>();Set<String> names=new HashSet<>();
          for(int i=1;i<=meta.getColumnCount();i++){
            String name=meta.getColumnLabel(i),kind=kind(meta.getColumnType(i));
            if(!names.add(name)) throw Api.bad("Dataset có tên cột trùng nhau; hãy đặt alias riêng trong SQL");
            List<String> aggregates=kind.equals("number")?AGGREGATES:kind.equals("other")?List.of("count"):List.of("count","count_distinct");
            columns.add(new Column(name,aliases.getOrDefault(name,name),meta.getColumnTypeName(i),kind,
                meta.isNullable(i)!=ResultSetMetaData.columnNoNulls,aggregates,kind.equals("date")?GRAINS:List.of(),meta.getColumnType(i)));
          }
          c.rollback();
          return new Metadata(datasetId,dataset.get("name").toString(),dataset.get("kind").toString(),List.copyOf(columns),
              Map.of("maxGroups",MAX_GROUPS,"maxMetrics",MAX_METRICS,"maxFilters",MAX_FILTERS,"maxResultRows",MAX_LIMIT,
                  "queryTimeoutSeconds",6,"filterOperators",OPERATORS));
        }
      }
    }catch(SQLException e){throw Api.bad("Không đọc được cấu trúc dataset; kiểm tra kết nối và định nghĩa nguồn");}
  }
  public Map<String,Object> analyze(UUID id,JsonNode body,Auth.Actor actor){
    auth.canEdit(actor);
    Request request;
    try { request=reader.readValue(body); }
    catch(java.io.IOException|IllegalArgumentException e){throw Api.bad("Yêu cầu phân tích không hợp lệ; kiểm tra trường và kiểu dữ liệu theo hợp đồng API");}
    Map<String,Object> dataset=datasets.get(id);
    Metadata metadata=inspect(id,dataset);
    Plan plan=compile(metadata,request,datasets.source(dataset));
    Map<String,Object> result=queries.run((UUID)dataset.get("connection_id"),plan.sql(),plan.parameters().toArray());
    @SuppressWarnings("unchecked") List<Map<String,Object>> rows=(List<Map<String,Object>>)result.get("rows");
    boolean truncated=Boolean.TRUE.equals(result.get("truncated")) || rows.size()>plan.limit();
    List<Map<String,Object>> visible=List.copyOf(rows.subList(0,Math.min(rows.size(),plan.limit())));
    auth.audit(actor,"ANALYZE","DATASET",id);
    return Map.of("datasetId",id,"columns",result.get("columns"),"rows",visible,"rowCount",visible.size(),
        "rowLimit",plan.limit(),"truncated",truncated);
  }
  static Plan compile(Metadata metadata,Request request,String source){
    if(request==null) throw Api.bad("Cần cấu hình phân tích");
    List<Group> groups=request.groupBy()==null?List.of():request.groupBy();
    List<Metric> metrics=request.metrics()==null?List.of():request.metrics();
    List<Filter> filters=request.filters()==null?List.of():request.filters();
    List<Order> orders=request.orderBy()==null?List.of():request.orderBy();
    int limit=request.limit()==null?100:request.limit();
    if(groups.size()>MAX_GROUPS || metrics.isEmpty() || metrics.size()>MAX_METRICS || filters.size()>MAX_FILTERS
        || orders.size()>MAX_GROUPS+MAX_METRICS || limit<1 || limit>MAX_LIMIT) throw Api.bad("Vượt giới hạn hoặc thiếu chỉ số phân tích");
    Map<String,Column> columns=new HashMap<>();metadata.columns().forEach(c->columns.put(c.name(),c));
    List<String> selections=new ArrayList<>(),groupExpressions=new ArrayList<>(),groupAliases=new ArrayList<>(),conditions=new ArrayList<>();
    Set<String> outputNames=new LinkedHashSet<>();List<Object> values=new ArrayList<>();
    for(Group group:groups){
      if(group==null) throw Api.bad("Chiều dữ liệu không hợp lệ");
      Column column=column(columns,group.column());
      if(column.kind().equals("other")) throw Api.bad("Cột không hỗ trợ chia nhóm");
      String expression=quoted(column.name());
      if(group.timeGrain()!=null){
        if(!column.timeGrains().contains(group.timeGrain())) throw Api.bad("Khoảng thời gian chỉ hỗ trợ day/month/year trên cột ngày");
        String date=expression;
        if(column.jdbcType()==Types.TIMESTAMP_WITH_TIMEZONE || column.type().equals("timestamptz")) date+=" AT TIME ZONE 'UTC'";
        expression="date_trunc('"+group.timeGrain()+"', "+date+")::date";
        conditions.add(quoted(column.name())+" IS NOT NULL");
      }
      String alias=group.alias()==null?column.name():alias(group.alias());
      unique(outputNames,alias);groupAliases.add(alias);groupExpressions.add(expression);
      selections.add(expression+" AS "+quoted(alias));
    }
    for(Metric metric:metrics){
      if(metric==null || metric.aggregate()==null || !AGGREGATES.contains(metric.aggregate())) throw Api.bad("Phép tổng hợp không được hỗ trợ");
      String field;
      if("*".equals(metric.column())){
        if(!metric.aggregate().equals("count")) throw Api.bad("Chỉ COUNT được dùng cột *");
        field="*";
      }else{
        Column column=column(columns,metric.column());
        if(!column.aggregates().contains(metric.aggregate())) throw Api.bad("Phép tổng hợp không phù hợp kiểu cột");
        field=quoted(column.name());
      }
      String alias=alias(metric.alias());unique(outputNames,alias);
      String aggregate=metric.aggregate().equals("count_distinct")?"COUNT(DISTINCT "+field+")":metric.aggregate().toUpperCase(Locale.ROOT)+"("+field+")";
      selections.add(aggregate+" AS "+quoted(alias));
    }
    for(Filter filter:filters){
      if(filter==null || !OPERATORS.contains(filter.operator()==null?"":filter.operator())) throw Api.bad("Toán tử lọc không được hỗ trợ");
      Column column=column(columns,filter.column());String field=quoted(column.name()),operator=filter.operator();
      if(operator.equals("is_null") || operator.equals("is_not_null")){
        if(filter.value()!=null && !filter.value().isNull()) throw Api.bad("Lọc NULL không nhận value");
        conditions.add(field+(operator.equals("is_null")?" IS NULL":" IS NOT NULL"));continue;
      }
      if(column.kind().equals("other")) throw Api.bad("Cột chỉ hỗ trợ kiểm tra NULL");
      if(operator.equals("in")){
        JsonNode array=filter.value();
        if(array==null || !array.isArray() || array.isEmpty() || array.size()>50) throw Api.bad("IN cần mảng từ 1 đến 50 giá trị");
        List<String> placeholders=new ArrayList<>();
        for(JsonNode item:array){values.add(value(column,item));placeholders.add("?");}
        conditions.add(field+" IN ("+String.join(",",placeholders)+")");continue;
      }
      if(Set.of("gt","gte","lt","lte").contains(operator) && !Set.of("number","date").contains(column.kind()))
        throw Api.bad("So sánh lớn/nhỏ chỉ dùng cho cột số hoặc ngày");
      String sqlOperator=switch(operator){case "eq"->"=";case "ne"->"<>";case "gt"->">";case "gte"->">=";case "lt"->"<";case "lte"->"<=";default->throw Api.bad("Toán tử không hợp lệ");};
      conditions.add(field+" "+sqlOperator+" ?");values.add(value(column,filter.value()));
    }
    List<String> sorting=new ArrayList<>();Set<String> sorted=new HashSet<>();
    for(Order order:orders){
      if(order==null || !outputNames.contains(order.column()) || !Set.of("asc","desc").contains(order.direction()==null?"":order.direction()) || !sorted.add(order.column()))
        throw Api.bad("Sắp xếp cần alias đầu ra duy nhất và hướng asc/desc");
      sorting.add(quoted(order.column())+" "+order.direction().toUpperCase(Locale.ROOT)+" NULLS LAST");
    }
    for(String name:groupAliases) if(sorted.add(name)) sorting.add(quoted(name)+" ASC NULLS LAST");
    String sql="SELECT "+String.join(", ",selections)+" FROM "+source
        +(conditions.isEmpty()?"":" WHERE "+String.join(" AND ",conditions))
        +(groupExpressions.isEmpty()?"":" GROUP BY "+String.join(", ",groupExpressions))
        +(sorting.isEmpty()?"":" ORDER BY "+String.join(", ",sorting))+" LIMIT "+(limit+1);
    return new Plan(sql,List.copyOf(values),limit);
  }
  private static Column column(Map<String,Column> columns,String name){
    Column column=columns.get(name);if(column==null) throw Api.bad("Cột không nằm trong dataset");return column;
  }
  private static String alias(String value){
    if(value==null || !value.matches("[A-Za-z_][A-Za-z0-9_]{0,62}")) throw Api.bad("Alias cần 1–63 ký tự chữ, số, dấu gạch dưới; không bắt đầu bằng số");
    return value;
  }
  private static void unique(Set<String> names,String name){if(!names.add(name)) throw Api.bad("Alias đầu ra bị trùng");}
  private static String quoted(String name){return "\""+name.replace("\"","\"\"")+"\"";}
  private static Object value(Column column,JsonNode node){
    if(node==null || node.isNull() || node.isContainerNode()) throw Api.bad("Giá trị lọc không hợp lệ; dùng is_null để lọc NULL");
    try {
      return switch(column.kind()){
        case "number"->{
          if(!node.isNumber()) throw Api.bad("Giá trị lọc cột số phải là số JSON");
          BigDecimal number=node.decimalValue();
          if(number.precision()>38 || Math.abs(number.scale())>12) throw Api.bad("Giá trị số vượt giới hạn");
          yield number;
        }
        case "date"->{
          if(!node.isTextual() || node.textValue().length()>64) throw Api.bad("Ngày lọc phải là chuỗi ISO");
          if(column.jdbcType()==Types.DATE) yield LocalDate.parse(node.textValue());
          if(column.jdbcType()==Types.TIMESTAMP_WITH_TIMEZONE || column.type().equals("timestamptz")) yield OffsetDateTime.parse(node.textValue());
          yield LocalDateTime.parse(node.textValue());
        }
        case "boolean"->{if(!node.isBoolean()) throw Api.bad("Giá trị lọc cần true/false");yield node.booleanValue();}
        case "text"->{if(!node.isTextual() || node.textValue().length()>500) throw Api.bad("Văn bản lọc tối đa 500 ký tự");yield node.textValue();}
        default->throw Api.bad("Kiểu cột không hỗ trợ giá trị lọc");
      };
    }catch(java.time.format.DateTimeParseException e){throw Api.bad("Ngày/giờ lọc không đúng định dạng ISO");}
    catch(NumberFormatException|ArithmeticException e){throw Api.bad("Giá trị số lọc vượt giới hạn");}
  }
  private static String kind(int type){
    return switch(type){
      case Types.SMALLINT,Types.INTEGER,Types.BIGINT,Types.NUMERIC,Types.DECIMAL,Types.REAL,Types.FLOAT,Types.DOUBLE->"number";
      case Types.DATE,Types.TIMESTAMP,Types.TIMESTAMP_WITH_TIMEZONE->"date";
      case Types.CHAR,Types.VARCHAR,Types.LONGVARCHAR,Types.NCHAR,Types.NVARCHAR,Types.LONGNVARCHAR->"text";
      case Types.BOOLEAN,Types.BIT->"boolean";
      default->"other";
    };
  }
  @RestController @RequestMapping("/api/datasets")
  public static class Controller {
    private final DatasetAnalysis service;private final Auth auth;
    Controller(DatasetAnalysis service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping("/{id}/metadata") Metadata metadata(@PathVariable String id,HttpServletRequest req){auth.actor(req);return service.metadata(Api.uuid(id));}
    @PostMapping("/{id}/analyze") Map<String,Object> analyze(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest req){return service.analyze(Api.uuid(id),body,auth.actor(req));}
  }
}
