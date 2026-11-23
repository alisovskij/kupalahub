import test from 'node:test';
import assert from 'node:assert/strict';
import { probePortal } from '../scripts/check-portal.js';
const reply = value => new Response(JSON.stringify(value));
test('portal probe sends secrets only as POST body and reports aggregate data',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.method,'POST');assert.equal(options.redirect,'error');
    assert.equal(new URL(url).origin,'https://edu.grsu.by');assert.equal(new URL(url).search,'');
    const body=options.body;
    if(url.endsWith('/token.php')){assert.equal(body.get('password'),'secret-password');assert.equal(body.get('service'),'moodle_mobile_app');return reply({token:'secret-token',privatetoken:'private-secret'});}
    assert.equal(body.get('wstoken'),'secret-token');
    const fn=body.get('wsfunction');
    if(fn==='core_webservice_get_site_info')return reply({userid:123,fullname:'Private Name',functions:[{name:'core_enrol_get_users_courses'},{name:'mod_assign_get_assignments'},{name:'core_enrol_get_enrolled_users'}]});
    if(fn==='core_enrol_get_users_courses')return reply([{id:7,fullname:'Private Course'}]);
    if(fn==='mod_assign_get_assignments')return reply({courses:[{id:7,assignments:[{name:'Private Assignment',duedate:123},{duedate:0}]}]});
    throw Error('Unexpected function');
  };
  const result=await probePortal({username:'private-login',password:'secret-password',fetchImpl});
  assert.equal(requests.length,4);assert.equal(result.authenticated,true);assert.equal(result.coursesRead.count,1);assert.equal(result.assignmentsRead.assignments,2);assert.equal(result.assignmentsRead.withDeadline,1);
  const encoded=JSON.stringify(result);for(const secret of ['secret-token','secret-password','private-login','Private Name','Private Course','Private Assignment','private-secret'])assert.ok(!encoded.includes(secret));
});
test('portal token errors stop the probe without exposing messages or calling other endpoints',async()=>{
  let calls=0;const result=await probePortal({username:'x',password:'y',fetchImpl:async()=>{calls++;return reply({error:'Contains secret',errorcode:'invalidlogin',debuginfo:'Private info'});}});
  assert.equal(calls,1);assert.equal(result.authenticated,false);assert.equal(result.errorCode,'invalidlogin');assert.ok(!JSON.stringify(result).includes('secret'));
});
test('existing token bypasses password endpoint; participant function does not trigger roster download',async()=>{
  let calls=0;const result=await probePortal({token:'token',fetchImpl:async(url,options)=>{calls++;assert.ok(!url.includes('/token.php'));assert.equal(options.body.get('wsfunction'),'core_webservice_get_site_info');return reply({userid:1,functions:[{name:'core_enrol_get_enrolled_users'}]});}});
  assert.equal(calls,1);assert.equal(result.capabilities.courseParticipants,true);assert.equal(result.coursesRead,undefined);
});
test('portal unknown errors are sanitized',async()=>{
  const result=await probePortal({token:'token',fetchImpl:async()=>reply({exception:'x',errorcode:'secret-custom-error',message:'Private'})});
  assert.equal(result.errorCode,'unknown_error');assert.ok(!JSON.stringify(result).includes('secret-custom'));
});

test('malformed site info never reports authenticated',async()=>{
  for(const value of [{},[],{userid:0,functions:[]},{userid:1,functions:[null]}]){
    await assert.rejects(probePortal({token:'token',fetchImpl:async()=>reply(value)}),{message:'response'});
  }
});
