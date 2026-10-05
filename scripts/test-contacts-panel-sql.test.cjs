// Isolated PostgreSQL: no credentials, real leads or outbound messages.
const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require('@electric-sql/pglite')
const {randomUUID}=require('node:crypto')
const schema={...require('./fixtures/integration-schema.json'),...require('./fixtures/manual-reset-schema.json')}
const tenant='a1b2c3d4-0001-4000-8000-000000000001', project='b1b2c3d4-0001-4000-8000-000000000001'
const sql=n=>fs.readFileSync('supabase/migrations/'+n,'utf8')
test('test contacts: enrollment, wait controls and scoped transactional resets',async t=>{
 const db=new PGlite(); const rows=async(s,p=[]) => (await db.query(s,p)).rows
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
  for(const [table,columns] of Object.entries(schema)) {
   const fields=Object.entries(columns).map(([name,type])=>`"${name}" ${/^(uuid|text|boolean|jsonb|json|smallint|integer|bigint|numeric|double precision|real|date|time without time zone|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(type)?type:'text'}${name==='id'?' PRIMARY KEY DEFAULT gen_random_uuid()':''}`)
   await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')})`)
  }
  await db.query('INSERT INTO tenants(id) VALUES($1)',[tenant]); await db.query('INSERT INTO projects(id,tenant_id) VALUES($1,$2)',[project,tenant])
  await db.exec('CREATE TABLE agent_prompts(tenant_id uuid,project_id uuid,name text,content text)');
  await db.exec(sql('20260909180000_kommo_app_runtime.sql'))
  await db.exec(`CREATE FUNCTION public.lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text)) $$;
   CREATE FUNCTION public.lv_app_visit_candidates() RETURNS SETOF jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb FROM public.leads l JOIN public.lv_auto_config c ON c.project_id=l.project_id WHERE NOT c.test_only OR l.id=c.test_lead_id $$;
   ALTER TABLE asesoria_financiamiento ADD FOREIGN KEY(prequalification_id) REFERENCES financing_prequalifications(id);
   ALTER TABLE messages ADD FOREIGN KEY(conversation_id) REFERENCES conversations(id);`)
  const a=randomUUID(),b=randomUUID()
  for(const [id,phone,k] of [[a,'+593991234567',101],[b,'0991234568',102]]){
   await db.query(`INSERT INTO leads(id,tenant_id,project_id,phone,kommo_id,bot_enabled,handoff_status,behavior_signals,budget) VALUES($1,$2,$3,$4,$5,true,'none','{"prior":true}',200000)`,[id,tenant,project,phone,k])
   const c=(await rows('INSERT INTO conversations(lead_id,tenant_id,project_id,summary) VALUES($1,$2,$3,\'prior\') RETURNING id',[id,tenant,project]))[0].id
   await db.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'cliente','prior')",[c])
  }
  await db.query('INSERT INTO lv_auto_config(tenant_id,project_id,test_lead_id,test_only) VALUES($1,$2,$3,true)',[tenant,project,a])
  await db.exec(sql('20261004210000_test_contacts_panel.sql')); await db.exec(sql('20261004211000_restart_enrolled_test_contact.sql'))
  const get=async phone=>(await rows('SELECT * FROM lv_test_contacts_state WHERE phone=$1',[phone]))[0]
  const mutate=async(action,c)=>db.query('SELECT lv_manage_test_contact($1,$2,$3)',[action,c.id,c.version])
  const restart=async c=>db.query('SELECT lv_restart_enrolled_test_contact($1,$2,NULL)',[c.id,c.version])
  await t.test('migration keeps legacy member and does not reset anything; RPCs are private',async()=>{
   assert.equal((await get('593991234567')).lead_id,a)
   assert.equal((await rows('SELECT count(*)::int n FROM messages'))[0].n,2)
   for(const role of ['anon','authenticated']) for(const fn of ['lv_manage_test_contact(text,uuid,integer,text,text,uuid)','lv_restart_enrolled_test_contact(uuid,integer,uuid)','lv_accelerate_test_messages(text[])'])
    assert.equal((await rows('SELECT has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn]))[0].allowed,false)
  })
  await t.test('add before a first message, duplicate prevention and local/international matching',async()=>{
   await db.query("SELECT lv_manage_test_contact('add',p_phone:='593991234568',p_label:='Second')")
   assert.equal((await get('593991234568')).lead_id,b)
   await assert.rejects(db.query("SELECT lv_manage_test_contact('add',p_phone:='593991234568')"),/TEST_CONTACT_DUPLICATE/)
   await db.query("SELECT lv_manage_test_contact('add',p_phone:='593991234569')")
   assert.equal((await get('593991234569')).matches,0)
   await assert.rejects(restart(await get('593991234569')),/TEST_CONTACT_NOT_LINKED/)
  })
  await t.test('only enrolled fast contacts skip 30 seconds, disabling restores pending deadlines',async()=>{
   await db.query('SELECT lv_app_receive($1)',[JSON.stringify([101,102,103].map(k=>({externalId:String(k),kommoId:k,contactId:k,text:'hi'})))])
   await mutate('fast_on',await get('593991234568'))
   const accelerated=(await rows('SELECT lv_accelerate_test_messages($1) contacts',[['inbound:101','inbound:102','inbound:103']]))[0].contacts
   assert.deepEqual(accelerated,['102:102'])
   assert.deepEqual((await rows('SELECT lv_accelerate_test_messages($1) contacts',[['inbound:102']]))[0].contacts,[])
   const before=(await rows("SELECT available_at,received_at,result FROM lv_integration_events WHERE event_key='inbound:102'"))[0]
   assert.ok(new Date(before.available_at)-new Date(before.received_at)<2000)
   await mutate('fast_off',await get('593991234568'))
   const after=(await rows("SELECT available_at,result FROM lv_integration_events WHERE event_key='inbound:102'"))[0]
   assert.equal(new Date(after.available_at).getTime(),new Date(before.result.test_original_available_at).getTime())
  })
  await t.test('stale versions and unregistered IDs cannot reset; active worker and unknown sends block reset',async()=>{
   const c=await get('593991234568')
   await assert.rejects(restart({...c,version:c.version-1}),/TEST_CONTACT_CHANGED/)
   await assert.rejects(restart({...c,id:randomUUID()}),/TEST_CONTACT_CHANGED/)
   const token=randomUUID();await db.query("SELECT lv_app_worker_lock($1,'acquire')",[token])
   await assert.rejects(restart(c),/TEST_RESET_BUSY/);await db.query("SELECT lv_app_worker_lock($1,'release')",[token])
   await db.query("UPDATE lv_integration_events SET status='uncertain' WHERE event_key='inbound:102'")
   await assert.rejects(restart(c),/TEST_RESET_BUSY/)
   await db.query("UPDATE lv_integration_events SET status='pending' WHERE event_key='inbound:102'")
  })
  await t.test('reset archives before deletion, clears state, keeps other lead and event dedupe',async()=>{
   const c=await get('593991234568')
   const pre=(await rows('INSERT INTO financing_prequalifications(lead_id) VALUES($1) RETURNING id',[b]))[0].id
   await db.query('INSERT INTO asesoria_financiamiento(lead_id,prequalification_id) VALUES($1,$2)',[b,pre])
   await restart(c)
   const backup=(await rows('SELECT snapshot FROM lv_manual_test_reset_backups WHERE lead_id=$1',[b]))[0].snapshot
   assert.equal(backup.messages.length,1);assert.equal(backup.financing_prequalifications.length,1)
   assert.equal((await rows('SELECT count(*)::int n FROM messages'))[0].n,1)
   assert.equal((await rows('SELECT budget,behavior_signals FROM leads WHERE id=$1',[b]))[0].budget,null)
   assert.equal((await rows('SELECT budget FROM leads WHERE id=$1',[a]))[0].budget,'200000')
   assert.equal((await rows("SELECT status FROM lv_integration_events WHERE event_key='inbound:102'"))[0].status,'cancelled')
   assert.ok((await get(c.phone)).last_reset_at)
  })
  await t.test('opt-out, commercial commitments and phone ambiguity block reset without losing context',async()=>{
   const c=await get('593991234567')
   for (const protection of ['opt_out','reservation','duplicate','foreign_scope']) {
    await db.exec('BEGIN')
    try {
     if(protection==='opt_out')await db.query('UPDATE leads SET tracking_opt_out_at=now() WHERE id=$1',[a])
     if(protection==='reservation')await db.query('INSERT INTO reservations(lead_id) VALUES($1)',[a])
     if(protection==='duplicate')await db.query('INSERT INTO leads(tenant_id,project_id,phone,kommo_id) VALUES($1,$2,$3,199)',[tenant,project,'0991234567'])
     if(protection==='foreign_scope')await db.query('UPDATE leads SET project_id=$1 WHERE id=$2',[randomUUID(),a])
     await assert.rejects(restart(c),/TEST_CONTACT_OPT_OUT|TEST_RESET_PROTECTED|TEST_CONTACT_AMBIGUOUS|TEST_CONTACT_NOT_LINKED/)
    } finally {await db.exec('ROLLBACK')}
    assert.equal((await rows('SELECT count(*)::int n FROM messages'))[0].n,1)
    assert.equal((await rows('SELECT count(*)::int n FROM lv_manual_test_reset_backups WHERE lead_id=$1',[a]))[0].n,0)
   }
  })
  await t.test('remove only drops enrollment and leaves CRM data intact',async()=>{
   await mutate('remove',await get('593991234567'))
   assert.equal(await get('593991234567'),undefined)
   assert.equal((await rows('SELECT count(*)::int n FROM messages'))[0].n,1)
   assert.equal((await rows('SELECT count(*)::int n FROM leads'))[0].n,2)
  })
 } finally {await db.close()}
})
