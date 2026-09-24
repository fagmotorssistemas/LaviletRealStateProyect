const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require('@electric-sql/pglite')
test('traceable evaluation: customer evidence, zero signals, retries, ACL and retired second cooling writer',async()=>{
 const db=new PGlite(),id='10000000-0000-4000-8000-000000000001',tenant='a1b2c3d4-0001-4000-8000-000000000001',project='b1b2c3d4-0001-4000-8000-000000000001'
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table leads(id uuid primary key,tenant_id uuid,project_id uuid,temperature text default 'frio',temperature_score int default 0,temperature_updated_at timestamptz,updated_at timestamptz);
   create table messages(conversation_id uuid,external_message_id text,role text,content text,sent_at timestamptz);
   create table conversations(id uuid,lead_id uuid);
   create table lead_scoring_rules(event_type text primary key,points int,reason text,repeatable boolean,active boolean);
   create table project_automation_config(project_id uuid,temperature_warm_min int,temperature_hot_min int);
   create table lead_score_events(lead_id uuid,event_type text,points int,reason text,source_message_id text,idempotency_key text,unique(lead_id,idempotency_key));
   create table lead_temperature_history(lead_id uuid,from_temperature text,to_temperature text,score int,reason text,created_at timestamptz);
   create table stage_calls(id uuid);
   create function set_lead_stage(uuid,text,text) returns void language sql as $$insert into stage_calls values($1)$$;
   insert into leads(id,tenant_id,project_id) values('${id}','${tenant}','${project}');
   insert into conversations values('${id}','${id}');
   insert into project_automation_config values('${project}',25,60);
   insert into lead_scoring_rules values('asked_price',25,'pregunto precio',false,true);
   insert into messages values('${id}','m1','cliente','precio','2026-09-23'),('${id}','m2','cliente','gracias','2026-09-23'),('${id}','bot','bot','precio','2026-09-23'),('${id}','audio','cliente','','2026-09-23');`)
  const existing=fs.readFileSync('supabase/migrations/20260905140000_automation_rules.sql','utf8')
  const match=existing.match(/create or replace function public\.apply_lead_events\([\s\S]*?\$function\$;/i)
  assert.ok(match);await db.exec(match[0])
  await db.exec(fs.readFileSync('supabase/migrations/20260923211512_interest_evaluation_evidence.sql','utf8'))
  const evaluate=(source,events)=>db.query('select lv_evaluate_message_interest($1,$2::jsonb,$3)',[id,JSON.stringify(events),source])
  await evaluate('m2',[])
  assert.ok((await db.query('select temperature_updated_at from leads')).rows[0].temperature_updated_at)
  assert.equal((await db.query('select * from stage_calls')).rows.length,0)
  await evaluate('m1',['asked_price']);await evaluate('m1',['asked_price'])
  assert.equal((await db.query('select temperature_score from leads')).rows[0].temperature_score,25)
  assert.equal((await db.query('select * from lead_score_events')).rows.length,1)
  assert.equal((await db.query('select * from stage_calls')).rows.length,1)
  assert.equal((await db.query('select * from lead_interest_evaluations')).rows.length,2)
  await assert.rejects(evaluate('bot',['asked_price']),/CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(evaluate('audio',['asked_price']),/CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(db.query("select lv3_store_cooling('{}')"),/LEGACY_COOLING_DISABLED/)
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'lv_evaluate_message_interest(uuid,jsonb,text)','execute') allowed",[role])).rows[0].allowed,false)
 }finally{await db.close()}
})
