package vn.pythera.bipoc;

import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DashboardScopeTests {
  @Test void savedScopeAlwaysCombinesWithRuntimeFilters() {
    var db=mock(JdbcTemplate.class);var charts=mock(Charts.class);
    var service=new DashboardInteraction(db,charts,mock(Datasets.class),mock(DatasetAnalysis.class),mock(Queries.class));
    UUID id=UUID.randomUUID(),dataset=UUID.randomUUID();
    when(db.queryForObject("SELECT scope_filters_json FROM dashboards WHERE id=?",String.class,id))
      .thenReturn("[{\"datasetId\":\""+dataset+"\",\"column\":\"day\",\"op\":\"date\",\"value\":\"2025-03-01\",\"end\":\"2025-03-31\"}]");
    var extra=Map.<String,Object>of("datasetId",dataset.toString(),"column","region","op","eq","value","A");
    assertEquals(1,service.effectiveFilters(id,Map.of()).size());
    var filters=service.effectiveFilters(id,Map.of("filters",List.of(extra)));
    assertEquals(2,filters.size());assertEquals("2025-03-31",filters.get(0).get("end"));assertEquals(extra,filters.get(1));
  }
}
