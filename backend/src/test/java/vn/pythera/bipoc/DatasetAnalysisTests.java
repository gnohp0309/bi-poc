package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.sql.Types;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class DatasetAnalysisTests {
  private final ObjectMapper mapper=new ObjectMapper();
  private final DatasetAnalysis.Metadata metadata=new DatasetAnalysis.Metadata(UUID.randomUUID(),"Sales","PHYSICAL",List.of(
      new DatasetAnalysis.Column("region","Region","text","text",true,List.of("count","count_distinct"),List.of(),Types.VARCHAR),
      new DatasetAnalysis.Column("amount","Revenue","numeric","number",true,DatasetAnalysis.AGGREGATES,List.of(),Types.NUMERIC),
      new DatasetAnalysis.Column("event_date","Date","date","date",true,List.of("count","count_distinct"),DatasetAnalysis.GRAINS,Types.DATE)
  ),Map.of());
  private DatasetAnalysis.Request request(String json) throws Exception {
    return DatasetAnalysis.requestReader(mapper).readValue(json);
  }
  private DatasetAnalysis.Plan plan(String json) throws Exception {
    return DatasetAnalysis.compile(metadata,request(json),"\"public\".\"orders\"");
  }
  @Test void hostileFilterValueRemainsABoundValue() throws Exception {
    String hostile="North' OR TRUE --";
    var body=mapper.readTree("""
        {"metrics":[{"column":"*","aggregate":"count","alias":"orders"}],
         "filters":[{"column":"region","operator":"eq","value":"North' OR TRUE --"}]}
        """);
    var query=DatasetAnalysis.compile(metadata,DatasetAnalysis.requestReader(mapper).readValue(body),"\"public\".\"orders\"");
    assertFalse(query.sql().contains(hostile));
    assertEquals(List.of(hostile),query.parameters());
  }
  @Test void inValuesAreBoundIndividually() throws Exception {
    var query=plan("""
        {"metrics":[{"column":"amount","aggregate":"sum","alias":"revenue"}],
         "filters":[{"column":"region","operator":"in","value":["North","South"]}]}
        """);
    assertEquals(List.of("North","South"),query.parameters());
    assertFalse(query.sql().contains("North"));
  }
  @ParameterizedTest @ValueSource(strings={
      "{}",
      "{\"metrics\":[{\"column\":\"password_cipher\",\"aggregate\":\"count\",\"alias\":\"x\"}]}",
      "{\"metrics\":[{\"column\":\"region\",\"aggregate\":\"sum\",\"alias\":\"x\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"sum\",\"alias\":\"x\"}]}",
      "{\"metrics\":[{\"column\":\"amount\",\"aggregate\":\"pg_sleep\",\"alias\":\"x\"}]}",
      "{\"metrics\":[{\"column\":\"amount\",\"aggregate\":\"sum\",\"alias\":\"x;DROP TABLE orders\"}]}",
      "{\"groupBy\":[{\"column\":\"region\",\"timeGrain\":\"month\"}],\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}]}",
      "{\"groupBy\":[{\"column\":\"region\"}],\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"region\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"limit\":501}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"limit\":0}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"orderBy\":[{\"column\":\"amount\",\"direction\":\"asc\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"region\",\"operator\":\"gt\",\"value\":\"a\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"amount\",\"operator\":\"eq\",\"value\":\"100\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"event_date\",\"operator\":\"gte\",\"value\":\"2025-02-30\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"region\",\"operator\":\"eq\",\"value\":null}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"region\",\"operator\":\"in\",\"value\":[]}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"region\",\"operator\":\"is_null\",\"value\":\"ignored\"}]}",
      "{\"groupBy\":[null],\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"amount\",\"operator\":\"eq\",\"value\":1e1000}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"filters\":[{\"column\":\"amount\",\"operator\":\"eq\",\"value\":1e-20}]}"
  }) void invalidOrUnscopedPlansAreRejected(String json) throws Exception {
    var input=request(json);
    Api.Failure error=assertThrows(Api.Failure.class,()->DatasetAnalysis.compile(metadata,input,"\"public\".\"orders\""));
    assertEquals(400,error.status);
  }
  @ParameterizedTest @ValueSource(strings={
      "{\"sql\":\"SELECT * FROM app_users\",\"metrics\":[]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\",\"sql\":\"pg_sleep(1)\"}]}",
      "{\"metrics\":[{\"column\":\"*\",\"aggregate\":\"count\",\"alias\":\"x\"}],\"limit\":1.5}"
  }) void unknownFieldsAndFractionalLimitsAreRejected(String json){
    assertThrows(com.fasterxml.jackson.core.JsonProcessingException.class,()->request(json));
  }
}
