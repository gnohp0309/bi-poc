package vn.pythera.bipoc;

import org.springframework.stereotype.Service;
import java.util.*;

/** Additional chart contracts; raw source values never become SQL identifiers without metadata validation. */
@Service
public class ChartVisualization {
  static final Set<String> TYPES=Set.of("kpi","histogram","scatter","heatmap","map","stacked-bar","stacked-area");
  static final Set<String> OPTIONS=Set.of("seriesDimension","numericColumns","binCount","latitude","longitude","labelColumn");
  private final Datasets datasets; private final DatasetAnalysis analysis; private final Queries queries;
  ChartVisualization(Datasets datasets,DatasetAnalysis analysis,Queries queries){this.datasets=datasets;this.analysis=analysis;this.queries=queries;}
  private static String q(String s){return "\""+s.replace("\"","\"\"")+"\"";}
  private static String finite(String x){return x+" IS NOT NULL AND "+x+"::text NOT IN ('NaN','Infinity','-Infinity')";}
  private static DatasetAnalysis.Column column(Map<String,DatasetAnalysis.Column> cols,String name,String kind){
    var col=cols.get(name);if(col==null)throw Api.bad("Cột không nằm trong dataset: "+name);
    if(kind!=null && !col.kind().equals(kind))throw Api.bad("Cột "+name+" cần kiểu "+kind);
    if(col.kind().equals("other"))throw Api.bad("Kiểu cột chưa hỗ trợ biểu đồ: "+name);
    return col;
  }
  public Map<String,Object> preview(Map<String,Object> spec,String filter){
    return preview(spec,filter,null,new Object[0]);
  }
  public Map<String,Object> preview(Map<String,Object> spec,String filter,String sourceOverride,Object[] sourceParams){
    UUID id=Api.uuid(Api.text(spec,"datasetId")); var dataset=datasets.get(id);
    UUID connection=(UUID)dataset.get("connection_id");String source=sourceOverride==null?datasets.source(dataset):sourceOverride;
    String type=Api.text(spec,"chartType"),metric=Api.optional(spec,"metric"),dimension=Api.optional(spec,"dimension"),aggregate=Api.text(spec,"aggregate").toLowerCase(Locale.ROOT);
    if(!Set.of("sum","avg","count").contains(aggregate))throw Api.bad("Phép tổng hợp không hợp lệ");
    Map<String,DatasetAnalysis.Column> cols=new HashMap<>();analysis.metadata(id).columns().forEach(c->cols.put(c.name(),c));
    if(filter!=null && !filter.isBlank()) {
      if(dimension.isEmpty() || type.equals("heatmap") || type.equals("map") || type.equals("histogram") || type.equals("kpi"))
        throw Api.bad("Dạng biểu đồ này chưa hỗ trợ bộ lọc chiều đơn hiện tại");
      column(cols,dimension,null);
      String expr=q(dimension);
      if("month".equals(Api.optional(spec,"timeGrain"))) {
        var col=column(cols,dimension,"date");
        if(col.type().equals("timestamptz"))expr+=" AT TIME ZONE 'UTC'";
        expr="to_char("+expr+",'YYYY-MM')";
      }
      // Values are bound by PreparedStatement, never interpolated.
      // Actual queries below use the same bound value via this source predicate.
      source="(SELECT * FROM "+source+" WHERE "+expr+"::text = ?) filtered";
    }
    var bound=new ArrayList<Object>(Arrays.asList(sourceParams));if(filter!=null && !filter.isBlank())bound.add(filter);
    Object[] params=bound.toArray();
    String sql; List<String> notes=new ArrayList<>();
    String grain=Api.optional(spec,"timeGrain");
    if(!grain.isEmpty() && (!grain.equals("month") || !type.startsWith("stacked-")))throw Api.bad("Nhóm tháng chỉ áp dụng cho stacked trên cột ngày");
    Map<String,Object> extra=new LinkedHashMap<>();
    switch(type){
      case "kpi" -> {
        String value;
        if(metric.equals("*")){if(!aggregate.equals("count"))throw Api.bad("* chỉ dùng với COUNT");value="*";}
        else {column(cols,metric,aggregate.equals("count")?null:"number");value=q(metric);}
        sql="SELECT "+aggregate+"("+value+") AS value FROM "+source+
            (aggregate.equals("count")?"":" WHERE "+finite(value));
        notes.add("KPI tổng hợp trên dữ liệu sau điều kiện lọc (nếu có); SUM/AVG không có số hợp lệ hiển thị —.");
      }
      case "histogram" -> {
        column(cols,metric,"number");String x=q(metric);int bins=10;
        if(spec.containsKey("binCount"))try {bins=new java.math.BigDecimal(spec.get("binCount").toString()).intValueExact();}catch(Exception e){throw Api.bad("Số khoảng phải là số nguyên");}
        if(bins<2 || bins>50)throw Api.bad("Số khoảng từ 2 đến 50");
        if(!aggregate.equals("count"))throw Api.bad("Histogram cần COUNT số dòng");
        sql="WITH vals AS MATERIALIZED (SELECT "+x+"::numeric v FROM "+source+" WHERE "+finite(x)+"), "+
            "bounds AS (SELECT min(v) lo,max(v) hi FROM vals), counts AS (SELECT CASE WHEN lo=hi THEN 0 ELSE least("+(bins-1)+",floor((v-lo)/(hi-lo)*"+bins+")::int) END idx,count(*) n FROM vals CROSS JOIN bounds GROUP BY 1) "+
            "SELECT s.idx AS bin,lo+(hi-lo)*s.idx/"+bins+" AS lower_bound,lo+(hi-lo)*(s.idx+1)/"+bins+" AS upper_bound,coalesce(counts.n,0) AS value "+
            "FROM bounds CROSS JOIN LATERAL generate_series(0,CASE WHEN lo=hi THEN 0 ELSE "+(bins-1)+" END) s(idx) LEFT JOIN counts ON counts.idx=s.idx WHERE lo IS NOT NULL ORDER BY s.idx";
        extra.put("binCount",bins);notes.add("Khoảng [cận dưới, cận trên); khoảng cuối gồm cận trên. Bỏ qua NULL và số không hữu hạn; không lấy mẫu.");
      }
      case "scatter" -> {
        column(cols,dimension,"number");column(cols,metric,"number");String x=q(dimension),y=q(metric);
        sql="SELECT "+x+" AS x,"+y+" AS y FROM "+source+" WHERE "+finite(x)+" AND "+finite(y)+" ORDER BY "+x+","+y;
        notes.add("Mỗi điểm là một dòng có đủ hai số hữu hạn; hiển thị tối đa 500 điểm đầu theo X/Y, không phải mẫu ngẫu nhiên.");
      }
      case "heatmap" -> {
        if(!(spec.get("numericColumns") instanceof List<?> raw) || raw.size()<2 || raw.size()>8)throw Api.bad("Heatmap cần từ 2 đến 8 cột số");
        List<String> names=new ArrayList<>();for(Object item:raw){if(!(item instanceof String name))throw Api.bad("Danh sách cột không hợp lệ");column(cols,name,"number");if(names.contains(name))throw Api.bad("Cột tương quan không được trùng");names.add(name);}
        List<String> cleaned=new ArrayList<>(),pairs=new ArrayList<>();
        for(int i=0;i<names.size();i++){String x=q(names.get(i));cleaned.add("CASE WHEN "+finite(x)+" THEN "+x+"::double precision END AS n"+i);}
        for(int i=0;i<names.size();i++)for(int j=i;j<names.size();j++){
          pairs.add("corr(n"+i+",n"+j+") AS c"+i+"_"+j);pairs.add("count(*) FILTER (WHERE n"+i+" IS NOT NULL AND n"+j+" IS NOT NULL) AS p"+i+"_"+j);
        }
        var matrix=queries.run(connection,"WITH clean AS (SELECT "+String.join(",",cleaned)+" FROM "+source+") SELECT "+String.join(",",pairs)+" FROM clean",params);
        @SuppressWarnings("unchecked") var values=((List<Map<String,Object>>)matrix.get("rows")).get(0);
        List<Map<String,Object>> rows=new ArrayList<>();
        for(int i=0;i<names.size();i++)for(int j=0;j<names.size();j++){
          int a=Math.min(i,j),b=Math.max(i,j);Map<String,Object> cell=new LinkedHashMap<>();cell.put("x",names.get(i));cell.put("y",names.get(j));cell.put("value",values.get("c"+a+"_"+b));cell.put("pairedCount",values.get("p"+a+"_"+b));rows.add(cell);
        }
        extra.put("numericColumns",names);notes.add("Tương quan Pearson, loại thiếu theo từng cặp. Cột hằng hoặc ít hơn 2 cặp có kết quả —; không phải kết luận nhân quả hay kiểm định p-value.");
        return response(spec,rows,List.of("x","y","value","pairedCount"),false,notes,extra);
      }
      case "map" -> {
        String lat=Api.text(spec,"latitude"),lon=Api.text(spec,"longitude");column(cols,lat,"number");column(cols,lon,"number");
        String x=q(lon),y=q(lat),label=Api.optional(spec,"labelColumn");if(!label.isEmpty())column(cols,label,null);
        String value;if(metric.equals("*")){if(!aggregate.equals("count"))throw Api.bad("* chỉ dùng với COUNT");value="*";}else{column(cols,metric,aggregate.equals("count")?null:"number");value=q(metric);}
        sql="SELECT "+x+" AS x,"+y+" AS y,"+(label.isEmpty()?"'Vị trí'":q(label)+"::text")+" AS label,"+aggregate+"("+value+") AS value FROM "+source+
            " WHERE "+finite(x)+" AND "+finite(y)+" AND "+y+" BETWEEN -90 AND 90 AND "+x+" BETWEEN -180 AND 180"+
            (aggregate.equals("count")?"":" AND "+finite(value))+" GROUP BY 1,2,3 ORDER BY 1,2,3";
        extra.put("latitude",lat);extra.put("longitude",lon);notes.add("Bản đồ điểm theo vĩ độ [-90,90], kinh độ [-180,180]. Bỏ dòng thiếu/sai tọa độ; tối đa 500 nhóm vị trí.");
      }
      case "stacked-bar","stacked-area" -> {
        var dim=column(cols,dimension,null);String series=Api.text(spec,"seriesDimension");column(cols,series,null);
        if(type.equals("stacked-area") && !dim.kind().equals("date"))throw Api.bad("Stacked area cần trục thời gian");
        String x=q(dimension);
        if(!grain.isEmpty()){
          if(!dim.kind().equals("date"))throw Api.bad("Nhóm tháng cần cột ngày");
          if(dim.type().equals("timestamptz"))x+=" AT TIME ZONE 'UTC'";
          x="to_char("+x+",'YYYY-MM')";
        }
        String value;if(metric.equals("*")){if(!aggregate.equals("count"))throw Api.bad("* chỉ dùng với COUNT");value="*";}else{column(cols,metric,aggregate.equals("count")?null:"number");value=q(metric);}
        sql="SELECT "+x+" AS label,"+q(series)+" AS series,"+aggregate+"("+value+") AS value FROM "+source+
            " WHERE "+q(dimension)+" IS NOT NULL"+(aggregate.equals("count")?"":" AND "+finite(value))+" GROUP BY 1,2 ORDER BY 1,2";
        extra.put("seriesDimension",series);notes.add("Tổng hợp theo trục và nhóm chuỗi; tối đa 500 nhóm kết quả. Dòng thiếu trục được loại.");
      }
      default -> throw Api.bad("Dạng biểu đồ không được hỗ trợ");
    }
    var result=queries.run(connection,sql,params);
    @SuppressWarnings("unchecked") var rows=(List<Map<String,Object>>)result.get("rows");
    @SuppressWarnings("unchecked") var resultColumns=(List<String>)result.get("columns");
    return response(spec,rows,resultColumns,Boolean.TRUE.equals(result.get("truncated")),notes,extra);
  }
  private static Map<String,Object> response(Map<String,Object> spec,List<Map<String,Object>> rows,List<String> columns,boolean truncated,List<String> notes,Map<String,Object> extra){
    Map<String,Object> result=new LinkedHashMap<>();for(String key:List.of("chartType","dimension","metric","aggregate","timeGrain"))result.put(key,Api.optional(spec,key));
    result.putAll(extra);result.put("rows",rows);result.put("columns",columns);result.put("truncated",truncated);result.put("notes",notes);return result;
  }
}
