package vn.pythera.bipoc;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.sql.*;
import java.util.*;

@Service
public class DashboardTemplates {
  private final Datasets datasets;
  private final Connections connections;
  private final Charts charts;
  private final Dashboards dashboards;
  private final Auth auth;
  private final Queries queries;
  public record Field(String key,String label,String kind) {}
  public record Column(String name,String type,String kind) {}
  public record Template(String id,String name,String description,List<Field> fields) {}
  private static final Template SALES=new Template("sales-overview","Tổng quan doanh thu",
      "Doanh thu theo tháng (đường), theo vùng (cột), theo danh mục (tròn).",
      List.of(new Field("date","Ngày","date"),new Field("revenue","Doanh thu","number"),
          new Field("region","Vùng","text"),new Field("category","Danh mục","text")));

  private static final Template PRODUCTS=new Template("product-analysis","Phân tích sản phẩm bán ra",
      "Doanh thu theo sản phẩm (cột), số lượng bán theo sản phẩm (cột), tỷ trọng doanh thu theo danh mục (tròn).",
      List.of(new Field("product","Sản phẩm","text"),new Field("revenue","Doanh thu","number"),
          new Field("quantity","Số lượng","number"),new Field("category","Danh mục","text")));
  private static final Template ORDER_STATUS=new Template("order-status","Theo dõi trạng thái đơn hàng",
      "Số đơn theo trạng thái (tròn), doanh thu theo trạng thái (cột), số đơn theo tháng (đường). Mỗi dòng dữ liệu được tính là một đơn hàng.",
      List.of(new Field("date","Ngày","date"),new Field("revenue","Doanh thu","number"),
          new Field("status","Trạng thái","text")));
  private record ChartSpec(String title,String type,String dimension,String metric,String timeGrain,String aggregate) {
    ChartSpec(String title,String type,String dimension,String metric,String timeGrain){
      this(title,type,dimension,metric,timeGrain,"sum");
    }
  }
  private static List<ChartSpec> chartSpecs(String templateId){
    if(templateId.equals("order-status")) return List.of(
        new ChartSpec("Số đơn theo trạng thái","pie","status","*",null,"count"),
        new ChartSpec("Doanh thu theo trạng thái","bar","status","revenue",null),
        new ChartSpec("Số đơn theo tháng","line","date","*","month","count"));
    if(templateId.equals("product-analysis")) return List.of(
        new ChartSpec("Doanh thu theo sản phẩm","bar","product","revenue",null),
        new ChartSpec("Số lượng bán theo sản phẩm","bar","product","quantity",null),
        new ChartSpec("Tỷ trọng doanh thu theo danh mục","pie","category","revenue",null));
    return List.of(new ChartSpec("Doanh thu theo tháng","line","date","revenue","month"),
        new ChartSpec("Doanh thu theo vùng","bar","region","revenue",null),
        new ChartSpec("Doanh thu theo danh mục","pie","category","revenue",null));
  }

  DashboardTemplates(Datasets datasets,Connections connections,Charts charts,Dashboards dashboards,Auth auth,Queries queries){
    this.datasets=datasets;this.connections=connections;this.charts=charts;this.dashboards=dashboards;this.auth=auth;this.queries=queries;
  }
  public List<Template> list(){return List.of(SALES,PRODUCTS,ORDER_STATUS);}
  static String kind(int type){
    return switch(type){
      case Types.SMALLINT,Types.INTEGER,Types.BIGINT,Types.NUMERIC,Types.DECIMAL,Types.REAL,Types.FLOAT,Types.DOUBLE -> "number";
      case Types.DATE,Types.TIMESTAMP,Types.TIMESTAMP_WITH_TIMEZONE -> "date";
      case Types.CHAR,Types.VARCHAR,Types.LONGVARCHAR,Types.NCHAR,Types.NVARCHAR,Types.LONGNVARCHAR -> "text";
      default -> "other";
    };
  }
  public List<Column> columns(UUID datasetId){
    var dataset=datasets.get(datasetId);
    try(Connection c=connections.open((UUID)dataset.get("connection_id"))){
      c.setReadOnly(true);c.setAutoCommit(false);
      try(Statement tx=c.createStatement()){tx.execute("SET TRANSACTION READ ONLY");}
      try(PreparedStatement st=c.prepareStatement("SELECT * FROM "+datasets.source(dataset)+" LIMIT 0")){
        st.setQueryTimeout(6);
        try(ResultSet rs=st.executeQuery()){
          var meta=rs.getMetaData();List<Column> result=new ArrayList<>();
          for(int i=1;i<=meta.getColumnCount();i++) result.add(new Column(meta.getColumnLabel(i),meta.getColumnTypeName(i),kind(meta.getColumnType(i))));
          c.rollback();return result;
        }
      }
    }catch(SQLException e){throw Api.bad("Không đọc được cấu trúc dataset");}
  }
  Template template(String id){return list().stream().filter(t->t.id().equals(id)).findFirst().orElseThrow(()->Api.bad("Template không tồn tại"));}
  static Map<String,Object> geometry(int index){return Map.of("position",index,"x",index==2?6:0,"y",index==0?0:10,"w",index==0?12:6,"h",index==0?10:9);}
  public List<Map<String,Object>> catalogue(){
    return list().stream().map(t->{
      var blueprint=new ArrayList<Map<String,Object>>();int i=0;
      for(var c:chartSpecs(t.id())){var item=new LinkedHashMap<String,Object>(geometry(i++));item.put("name",c.title());item.put("chartType",c.type());item.put("dimension",c.dimension());item.put("metric",c.metric());item.put("aggregate",c.aggregate());blueprint.add(item);}
      return Map.<String,Object>of("id",t.id(),"name",t.name(),"description",t.description(),"fields",t.fields(),"charts",blueprint);
    }).toList();
  }
  record Validation(Map<String,String> mapping,List<Map<String,String>> issues,List<String> warnings) {}
  Validation validate(Template template,UUID datasetId,Object raw){
    var available=new HashMap<String,Column>();for(var col:columns(datasetId))if(available.put(col.name(),col)!=null)throw Api.bad("Dataset có tên cột trùng nhau");
    Map<?,?> input=raw instanceof Map<?,?> map?map:Map.of();
    var mapping=new LinkedHashMap<String,String>();var issues=new ArrayList<Map<String,String>>();var warnings=new ArrayList<String>();
    for(var field:template.fields()){
      Object value=input.get(field.key());String problem=null;
      if(!(value instanceof String column) || column.isBlank())problem="Thiếu ánh xạ: "+field.label()+" ("+field.kind()+")";
      else {var col=available.get(column);
        if(col==null)problem="Cột không nằm trong dataset: "+column;
        else if(!field.kind().equals(col.kind()))problem="Cột "+field.label()+" cần kiểu "+field.kind()+", đã chọn "+col.type();
        else mapping.put(field.key(),column);
      }
      if(problem!=null)issues.add(Map.of("field",field.key(),"message",problem));
    }
    for(Object key:input.keySet())if(template.fields().stream().noneMatch(f->f.key().equals(key)))issues.add(Map.of("field",key.toString(),"message","Trường ánh xạ không thuộc template: "+key));
    if(new HashSet<>(mapping.values()).size()<mapping.size())warnings.add("Một cột đang được dùng cho nhiều vai trò; hãy xác nhận ý nghĩa nghiệp vụ trước khi tạo.");
    if(template.id().equals("order-status"))warnings.add("Mỗi dòng được tính là một đơn hàng; dataset nhiều dòng cho một đơn sẽ làm tăng số đơn. Template không tự khử trùng.");
    return new Validation(mapping,issues,warnings);
  }
  Map<String,Object> spec(UUID datasetId,ChartSpec chart,Map<String,String> mapping){
    var spec=new LinkedHashMap<String,Object>(Map.of("datasetId",datasetId.toString(),"name",chart.title(),"chartType",chart.type(),
        "dimension",mapping.get(chart.dimension()),"metric",chart.metric().equals("*")?"*":mapping.get(chart.metric()),"aggregate",chart.aggregate()));
    if(chart.timeGrain()!=null)spec.put("timeGrain",chart.timeGrain());return spec;
  }
  @SuppressWarnings("unchecked")
  public Map<String,Object> preview(String templateId,Map<String,Object> body){
    var template=template(templateId);UUID datasetId=Api.uuid(Api.text(body,"datasetId"));var validation=validate(template,datasetId,body.get("mapping"));
    var issues=validation.issues();var warnings=validation.warnings();var previews=new ArrayList<Map<String,Object>>();
    if(issues.isEmpty()){
      var dataset=datasets.get(datasetId);var select=new ArrayList<String>();select.add("count(*) AS row_count");int fieldIndex=0;
      for(var field:template.fields()){
        String col=DashboardInteraction.quote(validation.mapping().get(field.key()));select.add("count(*) FILTER (WHERE "+col+" IS NULL) AS missing_"+fieldIndex);
        if(field.kind().equals("number"))select.add("count(*) FILTER (WHERE "+col+"::text IN ('NaN','Infinity','-Infinity')) AS invalid_"+fieldIndex);
        fieldIndex++;
      }
      var summary=((List<Map<String,Object>>)queries.run((UUID)dataset.get("connection_id"),"SELECT "+String.join(",",select)+" FROM "+datasets.source(dataset)).get("rows")).get(0);
      long count=((Number)summary.get("row_count")).longValue();if(count==0)warnings.add("Dataset chưa có dòng dữ liệu. Dashboard được tạo sẽ hiển thị trạng thái không có dữ liệu.");
      fieldIndex=0;
      for(var field:template.fields()){
        long missing=((Number)summary.get("missing_"+fieldIndex)).longValue();
        if(missing>0)warnings.add(field.label()+" ("+validation.mapping().get(field.key())+"): "+missing+"/"+count+" dòng NULL. Ngày NULL không vào nhóm tháng; SUM bỏ qua số NULL; chiều văn bản NULL giữ thành nhóm trống.");
        if(field.kind().equals("number") && ((Number)summary.get("invalid_"+fieldIndex)).longValue()>0)issues.add(Map.of("field",field.key(),"message",field.label()+" chứa NaN/Infinity; cần dữ liệu số hữu hạn trước khi tạo template."));
        fieldIndex++;
      }
      int index=0;
      if(issues.isEmpty())for(var chart:chartSpecs(template.id())){
        var data=new LinkedHashMap<>(charts.preview(spec(datasetId,chart,validation.mapping()),null));data.putAll(geometry(index));data.put("id","template-preview-"+index++);data.put("name",chart.title());
        var rows=(List<Map<String,Object>>)data.get("rows");
        if(rows.size()>=100)warnings.add(chart.title()+": đã chạm giới hạn 100 nhóm; biểu đồ có thể chưa bao gồm toàn bộ nhóm dữ liệu.");
        if(chart.type().equals("pie") && rows.stream().anyMatch(r->r.get("value") instanceof Number n && n.doubleValue()<0))issues.add(Map.of("field",chart.metric(),"message",chart.title()+": tổng nhóm âm không phù hợp biểu đồ tròn; cần dataset hoặc template khác."));
        if(!rows.isEmpty() && rows.stream().allMatch(r->r.get("value")==null || (r.get("value") instanceof Number n && n.doubleValue()==0)))warnings.add(chart.title()+": tất cả nhóm không có giá trị hoặc bằng 0; biểu đồ có thể trống.");
        previews.add(data);
      }
    }
    return Map.of("templateId",templateId,"datasetId",datasetId,"eligible",issues.isEmpty(),"issues",issues,"warnings",warnings,"charts",previews,"mapping",validation.mapping());
  }
  @Transactional
  @SuppressWarnings("unchecked")
  public Map<String,Object> create(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);String templateId=Api.text(body,"templateId");var template=template(templateId);
    UUID datasetId=Api.uuid(Api.text(body,"datasetId"));String name=Api.text(body,"name");if(name.length()>120)throw Api.bad("Tên dashboard không được quá 120 ký tự");
    // Validate and execute previews again at create time; client previews are never trusted.
    var report=preview(templateId,body);var issues=(List<Map<String,String>>)report.get("issues");
    if(!issues.isEmpty())throw Api.bad(String.join("; ",issues.stream().map(i->i.get("message")).toList()));
    var mapping=(Map<String,String>)report.get("mapping");var items=new ArrayList<Map<String,Object>>();int index=0;
    for(var chart:chartSpecs(template.id())){UUID chartId=charts.save(spec(datasetId,chart,mapping),actor);var item=new LinkedHashMap<>(geometry(index++));item.remove("position");item.put("chartId",chartId.toString());items.add(item);}
    UUID id=dashboards.save(Map.of("name",name),actor);dashboards.layout(id,Map.of("items",items),actor);
    return Map.of("dashboardId",id,"warnings",report.get("warnings"));
  }
  @RestController @RequestMapping("/api")
  public static class Controller {
    private final DashboardTemplates service;private final Auth auth;
    Controller(DashboardTemplates service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping("/dashboard-templates") List<Map<String,Object>> list(HttpServletRequest req){auth.actor(req);return service.catalogue();}
    @GetMapping("/datasets/{id}/columns") List<Column> columns(@PathVariable String id,HttpServletRequest req){auth.actor(req);return service.columns(Api.uuid(id));}
    @PostMapping("/dashboard-templates/{id}/preview") Map<String,Object> preview(@PathVariable String id,@RequestBody Map<String,Object> body,HttpServletRequest req){auth.actor(req);return service.preview(id,body);}
    @PostMapping("/dashboards/from-template") Map<String,Object> create(@RequestBody Map<String,Object> body,HttpServletRequest req){return service.create(body,auth.actor(req));}
  }
}
