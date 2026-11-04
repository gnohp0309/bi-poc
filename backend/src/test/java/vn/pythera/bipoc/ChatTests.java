package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.math.BigDecimal;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import com.sun.net.httpserver.HttpServer;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChatTests {
  private final JdbcTemplate db=mock(JdbcTemplate.class);
  private final Datasets datasets=mock(Datasets.class);
  private final DatasetAnalysis analysis=mock(DatasetAnalysis.class);
  private final Auth auth=new Auth(db,new BCryptPasswordEncoder());
  private final Charts charts=mock(Charts.class);
  private final Dashboards dashboards=mock(Dashboards.class);
  private final DashboardTemplates templates=mock(DashboardTemplates.class);
  private final ObjectMapper mapper=new ObjectMapper();
  private final Chat chat=new Chat(db,datasets,analysis,auth,mapper,"http://127.0.0.1:1",charts,dashboards,templates);
  private final Auth.Actor admin=new Auth.Actor(UUID.randomUUID(),"test","ADMIN");
  private final Auth.Actor viewer=new Auth.Actor(UUID.randomUUID(),"viewer","VIEWER");

  @Test void viewerCannotStartOrExecuteOrDeleteChat() {
    assertEquals(403,assertThrows(Api.Failure.class,()->chat.createConversation(UUID.randomUUID(),"test",viewer)).status);
    assertEquals(403,assertThrows(Api.Failure.class,()->chat.sendMessage(UUID.randomUUID(),"sum",viewer)).status);
    assertEquals(403,assertThrows(Api.Failure.class,()->chat.deleteConversation(UUID.randomUUID(),viewer)).status);
    verifyNoInteractions(db,datasets,analysis,charts,dashboards);
  }
  @Test void answerPreservesDecimalAndLargeIntegerPrecision() {
    assertEquals("12.34",Chat.formatValue(new BigDecimal("12.3400")));
    assertEquals("90071992547409931234567890.12",Chat.formatValue(new BigDecimal("90071992547409931234567890.12")));
    assertEquals("NULL",Chat.formatValue(null));
  }
  @Test void literalDollarBackslashAndBracesAreNotRegex() {
    assertEquals("label: $5\\shop{{total}}",Chat.formatAnswer(Map.of("columns",List.of("label"),
        "rows",List.of(Map.of("label","$5\\shop{{total}}")))));
  }
  @Test void queryIgnoresInventedProseAndSavesActualData() throws Exception {
    UUID dataset=UUID.randomUUID();
    var config=mapper.readTree("{\"metrics\":[{\"column\":\"amount\",\"aggregate\":\"sum\",\"alias\":\"revenue\"}]}");
    var data=Map.<String,Object>of("columns",List.of("revenue"),"rows",List.of(Map.of("revenue",new BigDecimal("12.34"))),
        "rowCount",1,"truncated",false);
    when(analysis.analyze(dataset,config,admin)).thenReturn(data);
    var plan=new Chat.AIResponse("id","query",config,null,null,null,null,null,null,"Revenue is 999999999999");
    var response=chat.executePlan(UUID.randomUUID(),dataset,"total",plan,admin);
    assertEquals("revenue: 12.34",response.get("answer"));
    assertSame(data,response.get("data"));
    verify(analysis).analyze(dataset,config,admin);
  }
  @Test void invalidSecondChartNeverSavesFirstChartOrDashboard() {
    var good=Map.<String,Object>of("name","First","chartType","bar","dimension","region","metric","amount","aggregate","sum");
    var bad=Map.<String,Object>of("name","Second","chartType","bar","dimension","missing","metric","amount","aggregate","sum");
    when(charts.preview(anyMap(),isNull())).thenReturn(Map.of()).thenThrow(Api.bad("Missing column"));
    var plan=new Chat.AIResponse("id","create_dashboard",null,false,null,"Report",null,List.of(good,bad),null,null);
    assertThrows(Api.Failure.class,()->chat.executePlan(UUID.randomUUID(),UUID.randomUUID(),"dashboard",plan,admin));
    verify(charts,never()).save(anyMap(),any());
    verifyNoInteractions(db,dashboards);
  }
  @ParameterizedTest @ValueSource(ints={0,1,5})
  void customChartCountIsBounded(int count) {
    var spec=Map.<String,Object>of("name","Chart","chartType","bar","dimension","region","metric","*","aggregate","count");
    assertThrows(Api.Failure.class,()->Chat.customSpecs(Collections.nCopies(count,spec),UUID.randomUUID()));
  }
  @Test void customChartsCannotOverrideDatasetOrSupplySQL() {
    var spec=Map.<String,Object>of("name","Chart","sql","SELECT * FROM app_users");
    assertThrows(Api.Failure.class,()->Chat.customSpecs(List.of(spec,spec),UUID.randomUUID()));
  }
  @Test void emptyAndNullResultsRemainDistinct() {
    assertTrue(Chat.formatAnswer(Map.of("rows",List.of())).contains("Không tìm thấy"));
    var nullRow=new HashMap<String,Object>(); nullRow.put("sum",null);
    assertEquals("sum: NULL",Chat.formatAnswer(Map.of("columns",List.of("sum"),"rows",List.of(nullRow))));
  }
  @Test void unknownIntentDoesNotSaveMessages() {
    var plan=new Chat.AIResponse("id","execute_sql",null,null,null,null,null,null,null,null);
    assertThrows(Api.Failure.class,()->chat.executePlan(UUID.randomUUID(),UUID.randomUUID(),"query",plan,admin));
    verifyNoInteractions(db,analysis,charts,dashboards);
  }
  @ParameterizedTest @ValueSource(strings={"INVALID_PLAN","MISSING_API_KEY","PROVIDER_UNAVAILABLE"})
  void upstreamFailuresUseSafeSpecificMessages(String code) throws Exception {
    HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
    server.createContext("/analyze",exchange->{
      exchange.getResponseHeaders().set("X-AI-Error-Code",code);
      byte[] body="{\"detail\":\"secret-provider-diagnostic\"}".getBytes(StandardCharsets.UTF_8);
      exchange.sendResponseHeaders(502,body.length);
      try(var out=exchange.getResponseBody()) { out.write(body); }
    });
    server.start();
    try {
      var service=new Chat(db,datasets,analysis,auth,mapper,"http://127.0.0.1:"+server.getAddress().getPort(),charts,dashboards,templates);
      Api.Failure failure=assertThrows(Api.Failure.class,()->service.callAI(Map.of("request_id","test")));
      assertEquals(502,failure.status);
      assertFalse(failure.getMessage().contains("secret-provider-diagnostic"));
      if(code.equals("INVALID_PLAN")) {
        assertTrue(failure.getMessage().contains("cấu hình"));
        assertFalse(failure.getMessage().contains("API key"));
      }
      if(code.equals("MISSING_API_KEY")) assertTrue(failure.getMessage().contains("Chưa cấu hình Gemini"));
    } finally { server.stop(0); }
  }
}
