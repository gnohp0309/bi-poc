package vn.pythera.bipoc;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DashboardLayoutTests {
  private final String a=UUID.randomUUID().toString(),b=UUID.randomUUID().toString();
  private Map<String,Object> item(String id,Object x,Object y,Object w,Object h){return Map.of("chartId",id,"x",x,"y",y,"w",w,"h",h);}
  @Test void legacyOrderAndDeduplicationRemainCompatible(){
    var items=DashboardLayout.parse(Map.of("chartIds",List.of(a,b,a)));
    assertEquals(2,items.size());assertEquals(0,items.get(0).x());assertEquals(6,items.get(1).x());assertEquals(9,items.get(0).h());
  }
  @Test void gapsAndTouchingEdgesAreValid(){
    var items=DashboardLayout.parse(Map.of("items",List.of(item(a,0,0,12,10),item(b,3,10,6,8))));
    assertEquals(12,items.get(0).w());assertEquals(10,items.get(1).y());
  }
  @Test void invalidLayoutsAreRejectedBeforeWriting(){
    for(var bad:List.of(item(a,0,0,13,9),item(a,-1,0,6,9),item(a,7,0,6,9),item(a,0,0,6,5),item(a,0,999,6,9),item(a,0.5,0,6,9),item(a,"0",0,6,9))){
      assertThrows(Api.Failure.class,()->DashboardLayout.parse(Map.of("items",List.of(bad))));
    }
    assertThrows(Api.Failure.class,()->DashboardLayout.parse(Map.of("items",List.of(item(a,0,0,6,9),item(b,3,0,6,9)))));
    assertThrows(Api.Failure.class,()->DashboardLayout.parse(Map.of("items",List.of(item(a,0,0,6,9),item(a,6,0,6,9)))));
    assertThrows(Api.Failure.class,()->DashboardLayout.parse(Map.of("items",Collections.nCopies(25,item(a,0,0,6,9)))));
    assertThrows(Api.Failure.class,()->DashboardLayout.parse(Map.of("items",List.of(),"chartIds",List.of())));
  }
}
