/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL: no API, Kommo, credentials or production mutations.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('node:crypto')
const schema={...require('./fixtures/integration-schema.json'),...require('./fixtures/manual-reset-schema.json')}
const tenant='a1b2c3d4-0001-4000-8000-000000000001',project='b1b2c3d4-0001-4000-8000-000000000001'
const migration='20261013200000_complete_enrolled_test_reset.sql',sql=n=>fs.readFileSync('supabase/migrations/'+n,'utf8')
async function setup(){
 const db=new PGlite(),rows=async(s,p=[]) => (await db.query(s,p)).rows
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
 for(const [table,columns] of Object.entries(schema)){
  const fields=Object.entries(columns).map(([name,type])=>`"${name}" ${/^(uuid|text|boolean|jsonb|json|smallint|integer|bigint|numeric|double precision|real|date|time without time zone|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(type)?type:'text'}${name==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()':''}`)
  await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')})`)
 }
 await db.query('INSERT INTO tenants(id) VALUES($1)',[tenant]);await db.query('INSERT INTO projects(id,tenant_id) VALUES($1,$2)',[project,tenant])
 await db.exec(`CREATE TABLE agent_prompts(tenant_id uuid,project_id uuid,name text,content text);
  CREATE FUNCTION lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text))$$;
  CREATE FUNCTION lv_app_visit_candidates() RETURNS SETOF jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb FROM leads l JOIN lv_auto_config c ON c.project_id=l.project_id WHERE NOT c.test_only OR l.id=c.test_lead_id $$;
  ALTER TABLE contracts ADD FOREIGN KEY(reservation_id) REFERENCES reservations(id);
  ALTER TABLE unit_sales_closings ADD FOREIGN KEY(contract_id) REFERENCES contracts(id);
  ALTER TABLE messages ADD FOREIGN KEY(conversation_id) REFERENCES conversations(id);
  ALTER TABLE asesoria_financiamiento ADD FOREIGN KEY(prequalification_id) REFERENCES financing_prequalifications(id);
  CREATE TABLE test_contract_payments(contract_id uuid REFERENCES contracts(id),sequence integer,receipt text,PRIMARY KEY(contract_id,sequence));
  CREATE TABLE test_future_profile(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),lead_id uuid,confirmed_name text);
  ALTER TABLE leads ADD COLUMN bot_resumed_at timestamptz;
  ALTER TABLE leads ADD COLUMN bot_resumed_by uuid;
  ALTER TABLE leads ADD COLUMN future_confirmed_data jsonb;`)
 // Production name is required; a reset removes its declaration with an empty value.
 await db.exec('ALTER TABLE leads ALTER COLUMN name SET NOT NULL;')
 await db.exec(sql('20260909180000_kommo_app_runtime.sql'))
 await db.exec(sql('20260919013000_automation_execution_trace.sql'))
 const advisorSql=sql('20260920120000_advisor_manual_takeover_notifications.sql')
 await db.exec(advisorSql.slice(0,advisorSql.indexOf('CREATE OR REPLACE FUNCTION'))+'\nCOMMIT;')
 await db.exec(sql('20261005200000_conversation_workers.sql'))
 await db.exec(sql('20261004210000_test_contacts_panel.sql'))
 await db.exec(sql('20261005183000_explicit_bot_resume.sql'))
 await db.exec(sql('20260929101000_reservation_handoff_receipt.sql'))
 await db.exec(sql(migration))
 await db.exec(sql('20261013213000_complete_test_reset_timeout.sql'))
 return {db,rows}
}
test('complete reset applies to Carlos and Nathaly regardless of opt-out, sale, financing or pending delivery',async t=>{
 const {db,rows}=await setup()
 try{
  for(const [name,phone,kommo] of [['Carlos','593987110032',4454162],['Nathaly','593991234567',4469212]]){
   await t.test(name,async()=>{
    await db.exec('BEGIN')
    try{
     const lead=randomUUID(),other=randomUUID(),unit=randomUUID(),heldByOther=randomUUID(),actor=randomUUID()
     for(const [id,k,p] of [[lead,kommo,phone],[other,999999,'593991234568']])
      await db.query(`INSERT INTO leads(id,tenant_id,project_id,phone,kommo_id,contact_id,name,email,city,country,status,budget,financing,assigned_to,tracking_opt_out_at,bot_enabled,handoff_status,behavior_signals,future_confirmed_data)
       VALUES($1,$2,$3,$4,$5,$5::integer::text,$6,'old@example.com','Cuenca','Ecuador','vendido',400000,true,$7,now(),false,'requested','{"old":true}','{"old":true}')`,[id,tenant,project,p,k,name,actor])
     await db.query("SELECT lv_manage_test_contact('add',p_phone:=$1,p_label:=$2)",[phone,name])
     const contact=(await rows('SELECT * FROM lv_test_contacts_state WHERE phone=$1',[phone]))[0]
     const conversation=(await rows('INSERT INTO conversations(lead_id,tenant_id,project_id,summary) VALUES($1,$2,$3,\'old\') RETURNING id',[lead,tenant,project]))[0].id
     await db.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'cliente','old')",[conversation])
     await db.query("INSERT INTO test_future_profile(lead_id,confirmed_name) VALUES($1,'old')",[lead])
     const finance=(await rows('INSERT INTO financing_prequalifications(lead_id) VALUES($1) RETURNING id',[lead]))[0].id
     await db.query('INSERT INTO asesoria_financiamiento(lead_id,prequalification_id) VALUES($1,$2)',[lead,finance])
     for(const id of [unit,heldByOther])await db.query("INSERT INTO units(id,tenant_id,project_id,status) VALUES($1,$2,$3,'vendido')",[id,tenant,project])
     const reservation=(await rows('INSERT INTO reservations(lead_id,tenant_id,unit_id) VALUES($1,$2,$3) RETURNING id',[lead,tenant,unit]))[0].id
     const contract=(await rows('INSERT INTO contracts(lead_id,tenant_id,reservation_id) VALUES($1,$2,$3) RETURNING id',[lead,tenant,reservation]))[0].id
     await db.query('INSERT INTO test_contract_payments VALUES($1,1,\'payment\')',[contract])
     await db.query('INSERT INTO unit_sales_closings(lead_id,tenant_id,unit_id,contract_id) VALUES($1,$2,$3,$4)',[lead,tenant,unit,contract])
     await db.query('INSERT INTO reservations(lead_id,tenant_id,unit_id) VALUES($1,$2,$3)',[lead,tenant,heldByOther])
     await db.query('INSERT INTO reservations(lead_id,tenant_id,unit_id) VALUES($1,$2,$3)',[other,tenant,heldByOther])
     await db.query(`INSERT INTO lead_reservation_requests(lead_id,source_message_id,source_sent_at,conversation_id,unit_ids,evidence_message_ids,evidence,assignment_mode,handoff_status)
      VALUES($1,'old',now(),$2,'["502"]','["old"]','yes','queued','requested')`,[lead,conversation])
     const token=randomUUID(),otherToken=randomUUID(),key=`${kommo}:${kommo}`
     assert.equal((await rows('SELECT lv_app_contact_lock($1,$2) allowed',[token,key]))[0].allowed,true)
     assert.equal((await rows('SELECT lv_app_contact_lock($1,\'999999:999999\') allowed',[otherToken]))[0].allowed,true)
     const event=(await rows(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload,result,claim_token)
      VALUES($1,$2,'old-input','inbound','processing',$3,$4,'{"requires_review":true}',$5) RETURNING id`,[tenant,project,key,{kommoId:kommo,contactId:String(kommo)},token]))[0].id
     await db.query(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload,result)
      VALUES($1,$2,'old-unknown','inbound','uncertain',$3,$4,'{"requires_review":true}')`,[tenant,project,key,{kommoId:kommo}])
     const unresolved=(await rows(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload,result)
      VALUES($1,$2,'unresolved-advisor','advisor_outbound','uncertain',$3,$4,'{"requires_review":true}') RETURNING id`,
     [tenant,project,'contact:'+kommo,{contactId:String(kommo),kommoId:0}]))[0].id
     const journal=(await rows(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload,result)
      VALUES($1,$2,'__reply_registration__:old','lock','completed',$3,'{"task":"reply_registration"}',$4) RETURNING id`,[tenant,project,key,{delivery_state:'accepted',registration_state:'pending',args:{p_conversation_id:conversation},event_ids:[event]}]))[0].id
     await db.query("INSERT INTO lv_outbox(lead_id,tenant_id,project_id,status) VALUES($1,$2,$3,'uncertain')",[lead,tenant,project])
     const result=(await rows('SELECT lv_restart_enrolled_test_contact($1,$2,$3) result',[contact.id,contact.version,actor]))[0].result
     const backup=(await rows('SELECT snapshot FROM lv_manual_test_reset_backups WHERE id=$1',[result.backup_id]))[0].snapshot
     for(const table of ['conversations','messages','reservations','contracts','unit_sales_closings','test_contract_payments','test_future_profile','financing_prequalifications','asesoria_financiamiento','lv_outbox','lead_reservation_requests'])
      assert.ok(backup[table].length>0,table+' is backed up')
     for(const table of ['conversations','contracts','unit_sales_closings','test_future_profile','financing_prequalifications','asesoria_financiamiento','lv_outbox','lead_reservation_requests'])
      assert.equal((await rows(`SELECT count(*)::int n FROM ${table} WHERE lead_id=$1`,[lead]))[0].n,0,table+' is cleared')
     assert.equal((await rows('SELECT count(*)::int n FROM test_contract_payments'))[0].n,0)
     assert.equal((await rows('SELECT count(*)::int n FROM messages'))[0].n,0)
     const fresh=(await rows('SELECT * FROM leads WHERE id=$1',[lead]))[0]
     assert.equal(fresh.name,'')
     for(const field of ['email','city','country','budget','assigned_to','tracking_opt_out_at','future_confirmed_data'])assert.equal(fresh[field],null,field+' is reset')
     assert.equal(fresh.bot_enabled,true);assert.equal(fresh.financing,false);assert.equal(fresh.status,'nuevo');assert.equal(fresh.handoff_status,'none')
     assert.equal(fresh.bot_resumed_by,actor);assert.deepEqual(fresh.behavior_signals,{})
     assert.equal((await rows('SELECT status FROM units WHERE id=$1',[unit]))[0].status,'disponible')
     assert.equal((await rows('SELECT status FROM units WHERE id=$1',[heldByOther]))[0].status,'vendido')
     assert.equal((await rows('SELECT count(*)::int n FROM reservations WHERE lead_id=$1',[other]))[0].n,1)
     assert.equal((await rows('SELECT budget FROM leads WHERE id=$1',[other]))[0].budget,'400000')
     assert.equal((await rows("SELECT lv_app_worker_lock($1,'renew') allowed",[token]))[0].allowed,false)
     assert.equal((await rows("SELECT lv_app_worker_lock($1,'renew') allowed",[otherToken]))[0].allowed,true)
     assert.equal((await rows('SELECT status FROM lv_integration_events WHERE id=$1',[event]))[0].status,'cancelled')
     assert.equal((await rows('SELECT status FROM lv_integration_events WHERE id=$1',[unresolved]))[0].status,'cancelled')
     await db.query("UPDATE lv_integration_events SET status='uncertain',result='{\"requires_review\":true}' WHERE id=$1",[event])
     const retired=(await rows('SELECT status,result FROM lv_integration_events WHERE id=$1',[event]))[0]
     assert.equal(retired.status,'cancelled');assert.equal(retired.result.requires_review,false);assert.equal(retired.result.reset_cancelled,true)
     const checkpoint=(await rows('SELECT result FROM lv_integration_events WHERE id=$1',[journal]))[0].result
     assert.equal(checkpoint.delivery_state,'reset');assert.equal(checkpoint.recovery_complete,true)
     const audit=(await rows(`INSERT INTO lv_automation_execution_steps(tenant_id,project_id,event_id,lead_id,conversation_id,
      step_order,step_key,label,category,status,source_module,started_at,completed_at,output_summary)
      VALUES($1,$2,$3,$4,$5,1,'model_request','late inference','ai','failed','ai.ts',now(),now(),'{"token_usage":{"output_tokens":10}}') RETURNING conversation_id,output_summary`,
     [tenant,project,event,lead,conversation]))[0]
     assert.equal(audit.conversation_id,null);assert.equal(audit.output_summary.token_usage.output_tokens,10)
     const resetContact=(await rows('SELECT * FROM lv_test_contacts_state WHERE id=$1',[contact.id]))[0]
     assert.equal(resetContact.version,contact.version+1);assert.ok(resetContact.last_reset_at)
     for(const kind of ['inbound','advisor_outbound']){
      const late=(await rows(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload)
       VALUES($1,$2,$3,$4,'pending',$5,$6) RETURNING status,result`,[tenant,project,'late-'+kind,kind,key,{kommoId:kommo,sentAt:'2020-01-01T00:00:00Z'}]))[0]
      assert.equal(late.status,'cancelled');assert.equal(late.result.reason,'MESSAGE_BEFORE_TEST_RESET')
     }
     const next=(await rows(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload)
      VALUES($1,$2,'new-input','inbound','pending',$3,$4) RETURNING status`,[tenant,project,key,{kommoId:kommo,sentAt:new Date().toISOString()}]))[0]
     assert.equal(next.status,'pending')
    }finally{await db.exec('ROLLBACK')}
   })
  }
 }finally{await db.close()}
})
test('full reset remains private, requires fresh unambiguous enrollment and installs without clearing data',async()=>{
 const {db,rows}=await setup()
 try{
  const lead=randomUUID()
  await db.query('INSERT INTO leads(id,tenant_id,project_id,phone,name,budget) VALUES($1,$2,$3,\'593987110032\',\'old\',100000)',[lead,tenant,project])
  await db.query("SELECT lv_manage_test_contact('add',p_phone:='593987110032')")
  const contact=(await rows('SELECT * FROM lv_test_contacts_state'))[0]
  await db.exec(sql(migration));assert.equal((await rows('SELECT budget FROM leads WHERE id=$1',[lead]))[0].budget,'100000')
  await assert.rejects(db.query('SELECT lv_restart_enrolled_test_contact($1,$2,NULL)',[contact.id,contact.version-1]),/TEST_CONTACT_CHANGED/)
  await assert.rejects(db.query('SELECT lv_restart_enrolled_test_contact($1,1,NULL)',[randomUUID()]),/TEST_CONTACT_CHANGED/)
  await db.query('INSERT INTO leads(tenant_id,project_id,phone,name) VALUES($1,$2,\'0987110032\',\'duplicate\')',[tenant,project])
  await assert.rejects(db.query('SELECT lv_restart_enrolled_test_contact($1,$2,NULL)',[contact.id,contact.version]),/TEST_CONTACT_AMBIGUOUS/)
  for(const role of ['anon','authenticated'])assert.equal((await rows("SELECT has_function_privilege($1,'lv_restart_enrolled_test_contact(uuid,integer,uuid)','EXECUTE') allowed",[role]))[0].allowed,false)
 }finally{await db.close()}
})

test('reset clears a unique local lead without a Kommo link and keeps its test enrollment',async()=>{
 const {db,rows}=await setup()
 try{
  const lead=randomUUID()
  await db.query(`INSERT INTO leads(id,tenant_id,project_id,phone,name,budget,tracking_opt_out_at,bot_enabled)
   VALUES($1,$2,$3,'593987110032','old',100000,now(),false)`,[lead,tenant,project])
  await db.query("SELECT lv_manage_test_contact('add',p_phone:='593987110032')")
  const contact=(await rows('SELECT * FROM lv_test_contacts_state'))[0]
  const result=(await rows('SELECT lv_restart_enrolled_test_contact($1,$2,NULL) result',[contact.id,contact.version]))[0].result
  assert.equal(result.lead_id,lead)
  const fresh=(await rows('SELECT name,budget,tracking_opt_out_at,bot_enabled,kommo_id FROM leads WHERE id=$1',[lead]))[0]
  assert.deepEqual(fresh,{name:'',budget:null,tracking_opt_out_at:null,bot_enabled:true,kommo_id:null})
  assert.equal((await rows('SELECT count(*)::int n FROM lv_test_contacts'))[0].n,1)
 }finally{await db.close()}
})

test('reset invalidates a global worker processing this lead and preserves backup-worker admission',async()=>{
 const {db,rows}=await setup()
 try{
  const lead=randomUUID(),token=randomUUID()
  await db.query(`INSERT INTO leads(id,tenant_id,project_id,phone,name,kommo_id)
   VALUES($1,$2,$3,'593987110032','Carlos',4454162)`,[lead,tenant,project])
  await db.query("SELECT lv_manage_test_contact('add',p_phone:='593987110032')")
  const contact=(await rows('SELECT * FROM lv_test_contacts_state'))[0]
  assert.equal((await rows("SELECT lv_app_worker_lock($1,'acquire') allowed",[token]))[0].allowed,true)
  await db.query(`INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,payload,claim_token)
   VALUES($1,$2,'global-active','inbound','processing','{"kommoId":4454162}',$3)`,[tenant,project,token])
  await db.query('SELECT lv_restart_enrolled_test_contact($1,$2,NULL)',[contact.id,contact.version])
  assert.equal((await rows("SELECT lv_app_worker_lock($1,'renew') allowed",[token]))[0].allowed,false)
  assert.equal((await rows("SELECT lv_app_worker_lock($1,'acquire') allowed",[randomUUID()]))[0].allowed,true)
 }finally{await db.close()}
})

test('reset skips unrelated roots and empty dependent tables without running their DELETE triggers',async()=>{
 const {db,rows}=await setup()
 try{
  await db.exec(`CREATE TABLE unrelated_reset_root(id uuid PRIMARY KEY,lead_id uuid);
   CREATE TABLE empty_reset_child(id uuid PRIMARY KEY,conversation_id uuid REFERENCES conversations(id));
   CREATE FUNCTION reject_unnecessary_reset_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'UNNECESSARY_DELETE'; END $$;
   CREATE TRIGGER unrelated_delete BEFORE DELETE ON unrelated_reset_root FOR EACH STATEMENT EXECUTE FUNCTION reject_unnecessary_reset_delete();
   CREATE TRIGGER empty_delete BEFORE DELETE ON empty_reset_child FOR EACH STATEMENT EXECUTE FUNCTION reject_unnecessary_reset_delete();`)
  const lead=randomUUID(),other=randomUUID(),untouched=randomUUID()
  for(const [id,phone] of [[lead,'593987110032'],[other,'593991234567']])
   await db.query("INSERT INTO leads(id,tenant_id,project_id,phone,name) VALUES($1,$2,$3,$4,'old')",[id,tenant,project,phone])
  await db.query('INSERT INTO unrelated_reset_root VALUES($1,$2)',[untouched,other])
  await db.query('INSERT INTO conversations(lead_id,tenant_id,project_id) VALUES($1,$2,$3)',[lead,tenant,project])
  await db.query("SELECT lv_manage_test_contact('add',p_phone:='593987110032')")
  const contact=(await rows('SELECT * FROM lv_test_contacts_state WHERE lead_id=$1',[lead]))[0]
  const result=(await rows('SELECT lv_restart_enrolled_test_contact($1,$2,NULL) result',[contact.id,contact.version]))[0].result
  assert.equal(result.status,'reset');assert.equal(result.deleted.empty_reset_child,0)
  assert.equal((await rows('SELECT count(*)::int n FROM conversations WHERE lead_id=$1',[lead]))[0].n,0)
  assert.equal((await rows('SELECT count(*)::int n FROM unrelated_reset_root WHERE id=$1',[untouched]))[0].n,1)
  const configuration=(await rows("SELECT proconfig FROM pg_proc WHERE oid='lv_restart_enrolled_test_contact(uuid,integer,uuid)'::regprocedure"))[0].proconfig
  assert.ok(configuration.includes('statement_timeout=25s'))
 }finally{await db.close()}
})

test('a shared foreign-key child cannot cause another lead to be erased; the reset rolls back atomically',async()=>{
 const {db,rows}=await setup()
 try{
  await db.exec('CREATE TABLE shared_child(id uuid PRIMARY KEY,lead_id uuid,contract_id uuid REFERENCES contracts(id) ON DELETE CASCADE)')
  const lead=randomUUID(),other=randomUUID(),contract=randomUUID(),child=randomUUID()
  for(const [id,phone] of [[lead,'593987110032'],[other,'593991234567']])
   await db.query('INSERT INTO leads(id,tenant_id,project_id,phone,name,budget) VALUES($1,$2,$3,$4,\'old\',100000)',[id,tenant,project,phone])
  await db.query('INSERT INTO contracts(id,lead_id) VALUES($1,$2)',[contract,lead])
  await db.query('INSERT INTO shared_child VALUES($1,$2,$3)',[child,other,contract])
  await db.query("SELECT lv_manage_test_contact('add',p_phone:='593987110032')")
  const contact=(await rows('SELECT * FROM lv_test_contacts_state'))[0]
  await assert.rejects(db.query('SELECT lv_restart_enrolled_test_contact($1,$2,NULL)',[contact.id,contact.version]),/TEST_RESET_SCOPE_MISMATCH/)
  assert.equal((await rows('SELECT count(*)::int n FROM shared_child WHERE id=$1',[child]))[0].n,1)
  assert.equal((await rows('SELECT count(*)::int n FROM contracts WHERE id=$1',[contract]))[0].n,1)
  assert.equal((await rows('SELECT count(*)::int n FROM lv_manual_test_reset_backups'))[0].n,0)
  assert.equal((await rows('SELECT version FROM lv_test_contacts_state'))[0].version,contact.version)
 }finally{await db.close()}
})
