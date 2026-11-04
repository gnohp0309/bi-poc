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

  DashboardTemplates(Datasets datasets,Connections connections,Charts charts,Dashboards dashboards,Auth auth){
    this.datasets=datasets;this.connections=connections;this.charts=charts;this.dashboards=dashboards;this.auth=auth;
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
  @Transactional
  public Map<String,Object> create(Map<String,Object> body,Auth.Actor actor){
    auth.canEdit(actor);
    String templateId=Api.text(body,"templateId");
    Template template=list().stream().filter(t->t.id().equals(templateId)).findFirst()
        .orElseThrow(()->Api.bad("Template không tồn tại"));
    UUID datasetId=Api.uuid(Api.text(body,"datasetId"));String name=Api.text(body,"name");
    if(name.length()>120) throw Api.bad("Tên dashboard không được quá 120 ký tự");
    if(!(body.get("mapping") instanceof Map<?,?> raw)) throw Api.bad("Cần ánh xạ các cột dữ liệu");
    Map<String,Column> available=new HashMap<>();
    for(Column col:columns(datasetId)) if(available.put(col.name(),col)!=null) throw Api.bad("Dataset có tên cột trùng nhau");
    Map<String,String> mapping=new HashMap<>();
    for(Field field:template.fields()){
      Object value=raw.get(field.key());
      if(!(value instanceof String column) || column.isBlank()) throw Api.bad("Thiếu ánh xạ: "+field.label());
      Column col=available.get(column);
      if(col==null) throw Api.bad("Cột không nằm trong dataset: "+column);
      if(!field.kind().equals(col.kind())) throw Api.bad("Cột "+field.label()+" cần kiểu "+field.kind());
      mapping.put(field.key(),column);
    }
    List<String> ids=new ArrayList<>();
    for(ChartSpec chart:chartSpecs(template.id())){
      Map<String,Object> spec=new LinkedHashMap<>(Map.of("datasetId",datasetId.toString(),"name",chart.title(),
          "chartType",chart.type(),"dimension",mapping.get(chart.dimension()),"metric",chart.metric().equals("*")?"*":mapping.get(chart.metric()),"aggregate",chart.aggregate()));
      if(chart.timeGrain()!=null) spec.put("timeGrain",chart.timeGrain());
      ids.add(charts.save(spec,actor).toString());
    }
    UUID id=dashboards.save(Map.of("name",name),actor);
    dashboards.layout(id,Map.of("chartIds",ids),actor);
    return Map.of("dashboardId",id);
  }
  @RestController @RequestMapping("/api")
  public static class Controller {
    private final DashboardTemplates service;private final Auth auth;
    Controller(DashboardTemplates service,Auth auth){this.service=service;this.auth=auth;}
    @GetMapping("/dashboard-templates") List<Template> list(HttpServletRequest req){auth.actor(req);return service.list();}
    @GetMapping("/datasets/{id}/columns") List<Column> columns(@PathVariable String id,HttpServletRequest req){auth.actor(req);return service.columns(Api.uuid(id));}
    @PostMapping("/dashboards/from-template") Map<String,Object> create(@RequestBody Map<String,Object> body,HttpServletRequest req){return service.create(body,auth.actor(req));}
  }
}
