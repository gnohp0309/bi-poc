package vn.pythera.bipoc;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import java.sql.ResultSet;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AuthGroupTests {
  @SuppressWarnings({"unchecked","rawtypes"})
  @ParameterizedTest @ValueSource(booleans={false,true})
  void groupMembersAreJsonValuesInsteadOfJdbcObjects(boolean hasMember) throws Exception {
    JdbcTemplate db=mock(JdbcTemplate.class);
    BCryptPasswordEncoder encoder=new BCryptPasswordEncoder();
    Auth auth=new Auth(db,encoder);
    UUID groupId=UUID.randomUUID(),memberId=UUID.randomUUID();
    ResultSet rs=mock(ResultSet.class);
    java.sql.Array array=mock(java.sql.Array.class);
    when(rs.getObject("id",UUID.class)).thenReturn(groupId);
    when(rs.getString("name")).thenReturn("QA group");
    when(rs.getArray("members")).thenReturn(array);
    when(array.getArray()).thenReturn(hasMember?new UUID[]{memberId}:new UUID[]{});
    when(db.query(anyString(),any(RowMapper.class))).thenAnswer(call->List.of(((RowMapper)call.getArgument(1)).mapRow(rs,0)));
    MockHttpServletRequest request=new MockHttpServletRequest();
    request.setAttribute("actor",new Auth.Actor(UUID.randomUUID(),"admin","ADMIN"));
    var result=new Auth.Controller(auth,db,encoder).groups(request);
    var json=new ObjectMapper().readTree(new ObjectMapper().writeValueAsString(result));
    assertTrue(json.get(0).get("members").isArray());
    assertEquals(hasMember?1:0,json.get(0).get("members").size());
    if(hasMember) assertEquals(memberId.toString(),json.get(0).get("members").get(0).textValue());
    verify(array).free();
  }
}
