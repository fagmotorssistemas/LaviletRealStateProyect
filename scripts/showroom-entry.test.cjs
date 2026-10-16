/* eslint-disable @typescript-eslint/no-require-imports -- Exercise the server entry with a controlled database. */
const test=require('node:test'),assert=require('node:assert/strict')
const data=require('../src/lib/integrations/automation/data.ts')
const {applyShowroomEntry}=require('../src/lib/integrations/automation/showroom-contact.ts')
const {showroomInvitationBody}=require('../src/lib/tour/showroomInterest.ts')
const {resolvePropertyTurn}=require('../src/lib/integrations/automation/property-context.ts')
function fixture(t,{outbound=[],status='accepted'}={}){
 const changes=[],rpcCalls=[],record={id:'invitation',lead_id:'lead',status,unit_id:'unit605',unit_label:'el penthouse 605',form_name:'Cliente',accepted_at:new Date(Date.now()-60000).toISOString()}
 const db={from(table){const chain={select(){return chain},match(){return chain},eq(){return chain},in(){return chain},gte(){return chain},gt(){return chain},order(){return chain},limit(){return chain},update(value){changes.push({table,value});return chain},maybeSingle:async()=>({data:record,error:null}),then(resolve,reject){return Promise.resolve({error:null,data:table==='conversations'?[{id:'conversation'}]:table==='messages'?outbound:[]}).then(resolve,reject)}};return chain}}
 t.mock.method(data,'db',()=>db);t.mock.method(data,'rpc',async(name,args)=>{rpcCalls.push({name,args});return true})
 return {changes,rpcCalls}
}
test('the late echo of the invitation keeps its subject and imports the form name without selecting a unit',async t=>{
 const f=fixture(t,{outbound:[{id:'echo',content:showroomInvitationBody('el penthouse 605')}]});const summary=await applyShowroomEntry({id:'lead'},{},'Sí, quiero información')
 assert.equal(summary._lead_profile.full_name,'Cliente');assert.equal(summary._showroom_entry.response_kind,'information');assert.deepEqual(summary._property_context.selected_ids,[]);assert.deepEqual(summary._property_context.focused_ids,['unit605']);assert.equal(f.changes[0].value.status,'responded')
})
test('a different subsequent outbound prevents treating a yes as showroom acceptance',async t=>{
 fixture(t,{outbound:[{id:'new-topic',content:'¿Desea iniciar una solicitud de reserva?'}]});const summary=await applyShowroomEntry({id:'lead'},{},'sí');assert.equal(summary._showroom_entry,undefined);assert.equal(summary._lead_profile.full_name,'Cliente')
})

test('accepting showroom information stays informational through catalog resolution even if extraction calls it a choice',async t=>{
 fixture(t);const current='Sí, quiero información',summary=await applyShowroomEntry({id:'lead'},{},current);
 for(const reply of [current,'sí']){
  const resolved=resolvePropertyTurn([{id:'unit605',unit_number:'605',category:'penthouse',bedrooms:3,is_published:true,status:'disponible'}],reply,summary,[],{primary_intent:'select_property',confidence:'high',property:{operation:'select',reference_kind:'followup',query_scope:'offered',evidence:reply,confidence:'high'},previous_answer:{question_id:'showroom_information',kind:'affirmative',evidence:reply,confidence:'high'}});
  assert.deepEqual(resolved.context.selected_ids,[]);assert.equal(resolved.query.operation,'details');assert.deepEqual(resolved.matches.map(row=>row.id),['unit605']);assert.equal(resolved.needsClarification,false);
 }
});
test('a handled invitation can recover its form identity after a generation failure without accepting twice',async t=>{
 const f=fixture(t,{status:'responded'});const summary=await applyShowroomEntry({id:'lead'},{},'¿Y cuál es el precio?');assert.equal(summary._lead_profile.full_name,'Cliente');assert.equal(f.changes.length,0)
})
test('stop registers opt-out and cancels pending follow-ups',async t=>{
 const f=fixture(t);await applyShowroomEntry({id:'lead'},{},'No recibir mensajes');assert.equal(f.rpcCalls[0].name,'set_tracking_preference');assert.equal(f.rpcCalls[0].args.p_consent,false);assert.ok(f.changes.some(row=>row.table==='lv_integration_events'&&row.value.status==='cancelled'))
})
