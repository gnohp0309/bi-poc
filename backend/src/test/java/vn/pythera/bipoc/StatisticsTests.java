package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class StatisticsTests {
  private final ObjectMapper mapper=new ObjectMapper();
  private final DatasetAnalysis.Metadata metadata=new DatasetAnalysis.Metadata(UUID.randomUUID(),"Test","PHYSICAL",List.of(
      new DatasetAnalysis.Column("amount","Amount","numeric","number",true,List.of(),List.of(),1),
      new DatasetAnalysis.Column("before","Before","numeric","number",true,List.of(),List.of(),1),
      new DatasetAnalysis.Column("group","Group","text","text",true,List.of(),List.of(),1)),Map.of());
  private Statistics.Plan validate(String json)throws Exception{return Statistics.validate(mapper.readTree(json),metadata);}
  @Test void acceptsKnownNumericColumnsAndExplicitGroups()throws Exception {
    var plan=validate("{\"operation\":\"independent_ttest\",\"value_column\":\"amount\",\"group_column\":\"group\",\"group_values\":[\"A\",\"B\"],\"equal_variance\":false}");
    assertEquals(List.of("amount","group"),plan.columns());assertEquals(false,plan.parameters().get("equal_variance"));
  }
  @Test void rejectsSqlAndOtherDatasetColumnsBeforeReadingData()throws Exception {
    for(String body:List.of("{\"operation\":\"descriptive\",\"columns\":[\"secret\"]}",
        "{\"operation\":\"descriptive\",\"columns\":[\"amount\"],\"sql\":\"SELECT 1\"}",
        "{\"operation\":\"descriptive\",\"columns\":[\"group\"]}"))
      assertThrows(Api.Failure.class,()->validate(body));
  }
  @Test void rejectsDuplicatesAndUnknownOperation() {
    for(String body:List.of("{\"operation\":\"correlation\",\"columns\":[\"amount\",\"amount\"]}","{\"operation\":\"run_python\"}"))assertThrows(Api.Failure.class,()->validate(body));
  }
  @Test void rejectsInvalidMethodsThresholdsAndBooleanCoercion() {
    for(String body:List.of("{\"operation\":\"outlier\",\"column\":\"amount\",\"method\":\"pearson\"}",
        "{\"operation\":\"outlier\",\"column\":\"amount\",\"threshold\":-1}",
        "{\"operation\":\"shapiro_wilk\",\"column\":\"amount\",\"alpha\":\"0.05\"}",
        "{\"operation\":\"independent_ttest\",\"value_column\":\"amount\",\"group_column\":\"group\",\"equal_variance\":\"false\"}"))assertThrows(Api.Failure.class,()->validate(body));
  }
  @Test void quotesMetadataIdentifiersAndRejectsSamePairedColumns() {
    assertEquals("\"a\"\"b\"",Statistics.quoted("a\"b"));
    assertThrows(Api.Failure.class,()->validate("{\"operation\":\"paired_ttest\",\"column_before\":\"amount\",\"column_after\":\"amount\"}"));
  }
}
