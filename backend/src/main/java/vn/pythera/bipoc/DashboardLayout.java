package vn.pythera.bipoc;

import java.math.BigDecimal;
import java.util.*;

/** Twelve-column grid. Legacy chartIds requests retain their two-column order semantics. */
final class DashboardLayout {
  record Item(UUID chartId,int x,int y,int w,int h) {}
  static List<Item> parse(Map<String,Object> body) {
    if(body.containsKey("items") && body.containsKey("chartIds"))throw Api.bad("Chỉ gửi items hoặc chartIds");
    boolean grid=body.containsKey("items");Object raw=body.get(grid?"items":"chartIds");
    if(!(raw instanceof List<?> list) || list.size()>24)throw Api.bad("Cần danh sách tối đa 24 biểu đồ");
    List<Item> result=new ArrayList<>();Set<UUID> ids=new HashSet<>();
    for(Object value:list) {
      UUID chartId;int x,y,w,h;
      if(grid){
        if(!(value instanceof Map<?,?> item) || !item.keySet().equals(Set.of("chartId","x","y","w","h")))throw Api.bad("Mỗi ô cần chartId, x, y, w, h");
        if(!(item.get("chartId") instanceof String id))throw Api.bad("chartId không hợp lệ");
        chartId=Api.uuid(id);x=integer(item.get("x"));y=integer(item.get("y"));w=integer(item.get("w"));h=integer(item.get("h"));
        if(x<0 || y<0 || w<3 || w>12 || h<6 || h>24 || x>12-w || y>1000-h)throw Api.bad("Ô cần nằm trong lưới 12 cột, rộng 3–12 cột, cao 6–24 hàng và không vượt hàng 1000");
      }else{
        if(!(value instanceof String id))throw Api.bad("chartId không hợp lệ");chartId=Api.uuid(id);
        if(ids.contains(chartId))continue;
        int pos=result.size();x=(pos%2)*6;y=(pos/2)*9;w=6;h=9;
      }
      if(!ids.add(chartId))throw Api.bad("Biểu đồ bị trùng trong bố cục");
      Item item=new Item(chartId,x,y,w,h);
      if(result.stream().anyMatch(other->overlaps(item,other)))throw Api.bad("Các ô biểu đồ không được chồng lên nhau");
      result.add(item);
    }
    return result;
  }
  private static int integer(Object value){
    if(!(value instanceof Number))throw Api.bad("Tọa độ và kích thước phải là số nguyên");
    try{return new BigDecimal(value.toString()).intValueExact();}catch(Exception e){throw Api.bad("Tọa độ và kích thước phải là số nguyên");}
  }
  private static boolean overlaps(Item a,Item b){return a.x()<b.x()+b.w() && b.x()<a.x()+a.w() && a.y()<b.y()+b.h() && b.y()<a.y()+a.h();}
}
