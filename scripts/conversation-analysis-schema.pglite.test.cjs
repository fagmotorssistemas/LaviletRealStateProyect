/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS test harness. */
/* Isolated PostgreSQL authorization and scheduler checks; no external services. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite')
const tenant='10000000-0000-4000-8000-000000000001',otherTenant='10000000-0000-4000-8000-000000000002',project='20000000-0000-4000-8000-000000000001',otherProject='20000000-0000-4000-8000-000000000002',owner='30000000-0000-4000-8000-000000000001',other='30000000-0000-4000-8000-000000000002',outsider='30000000-0000-4000-8000-000000000003',lead='40000000-0000-4000-8000-000000000001',conversation='50000000-0000-4000-8000-000000000001'
async function fixture(t,applyMigrations=true){const db=new PGlite();t.after(()=>db.close());await db.exec(`
 create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema public,auth to authenticated;grant execute on function auth.uid() to authenticated;
 create table tenants(id uuid primary key);create table projects(id uuid primary key);
 create table profiles(id uuid primary key,role text,is_active boolean,project_id uuid);
 create table leads(id uuid primary key,tenant_id uuid,project_id uuid,assigned_to uuid,kommo_id bigint,handoff_status text default 'none',seller_response_due_at timestamptz,updated_at timestamptz default now()-interval '1 day',last_interaction_at timestamptz default now());
 create table conversations(id uuid primary key,lead_id uuid,last_message_at timestamptz);
 create table messages(id uuid primary key,conversation_id uuid,sent_at timestamptz);
 create table lead_conversation_analyses(id uuid primary key default gen_random_uuid(),conversation_id uuid,created_at timestamptz,source_last_message_at timestamptz,analysis jsonb);
 create table lv_integration_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,project_id uuid,kind text,status text,payload jsonb default '{}',result jsonb default '{}',contact_key text,received_at timestamptz default now());
 create table lead_reservation_requests(id uuid primary key default gen_random_uuid(),lead_id uuid,notification_status text);
 create function lv_can_manage_lead_commercial_profile(customer_id uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from leads l join profiles p on p.id=auth.uid() where l.id=customer_id and p.is_active and p.project_id=l.project_id) $$;
 insert into tenants values('${tenant}'),('${otherTenant}');insert into projects values('${project}'),('${otherProject}');
 insert into profiles values('${owner}','asesor',true,'${project}'),('${other}','asesor',true,'${project}'),('${outsider}','asesor',true,'${otherProject}');
 insert into leads(id,tenant_id,project_id,assigned_to,kommo_id) values('${lead}','${tenant}','${project}','${owner}',12345);
 insert into conversations values('${conversation}','${lead}',now()-interval '30 hours');insert into messages values(gen_random_uuid(),'${conversation}',now()-interval '30 hours');
 grant select on leads,profiles to authenticated;
 `);if(applyMigrations)for(const file of ['20261016220000_conversation_analysis_reviews.sql','20261016221000_conversation_analysis_v2_candidates.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));return db}

test('missing commercial permission dependency fails before creating the reviews table',async t=>{
 const db=await fixture(t,false);await db.exec('drop function lv_can_manage_lead_commercial_profile(uuid)');
 await assert.rejects(db.exec(fs.readFileSync('supabase/migrations/20261016220000_conversation_analysis_reviews.sql','utf8')),/20261015210000_lead_commercial_pipeline/);
 await db.exec('rollback');assert.equal((await db.query("select to_regclass('public.lead_conversation_analysis_reviews')::text name")).rows[0].name,null)
})
test('reapplying the reviews migration preserves existing notes and authorization policies',async t=>{
 const db=await fixture(t),signature='a'.repeat(64);
 await db.exec(`insert into lead_conversation_analysis_reviews(tenant_id,project_id,lead_id,actor_id,status,note,issue_signature) values('${tenant}','${project}','${lead}','${owner}','reviewing','Revision existente que debe conservarse','${signature}')`);
 await db.exec(fs.readFileSync('supabase/migrations/20261016220000_conversation_analysis_reviews.sql','utf8'));
 assert.equal((await db.query('select count(*)::integer n from lead_conversation_analysis_reviews')).rows[0].n,1);
 assert.equal((await db.query("select count(*)::integer n from pg_policies where tablename='lead_conversation_analysis_reviews'")).rows[0].n,2)
})
test('review notes enforce owner, actor and project scope; they do not modify sales state',async t=>{
 const db=await fixture(t),signature='a'.repeat(64),insert=(actor,projectId=project)=>`insert into lead_conversation_analysis_reviews(tenant_id,project_id,lead_id,actor_id,status,note,issue_signature) values('${tenant}','${projectId}','${lead}','${actor}','actioned','Consulta comprobada y atendida','${signature}')`
 await db.exec(`select set_config('request.jwt.claim.sub','${owner}',false);set role authenticated;`);await db.exec(insert(owner));assert.equal((await db.query('select * from lead_conversation_analysis_reviews')).rows.length,1)
 await assert.rejects(db.exec(insert(other)),/row-level security/)
 await assert.rejects(db.exec(insert(owner,otherProject)),/row-level security/)
 await assert.rejects(db.exec("update lead_conversation_analysis_reviews set status='resolved'"),/permission denied/)
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);assert.equal((await db.query('select * from lead_conversation_analysis_reviews')).rows.length,1);await assert.rejects(db.exec(insert(other)),/row-level security/)
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','${outsider}',false);set role authenticated;`);assert.equal((await db.query('select * from lead_conversation_analysis_reviews')).rows.length,0);await assert.rejects(db.exec(insert(outsider)),/row-level security/)
 await db.exec('reset role');assert.equal((await db.query('select handoff_status from leads')).rows[0].handoff_status,'none');assert.equal((await db.query('select count(*)::integer n from messages')).rows[0].n,1)
 assert.equal((await db.query("select has_table_privilege('anon','lead_conversation_analysis_reviews','select') allowed")).rows[0].allowed,false)
})
test('scheduler includes urgent fresh conversations, respects test scope and does not repeat unchanged v2 analyses',async t=>{
 const db=await fixture(t),candidates=()=>db.query('select * from lv_idle_analysis_candidate($1,$2)',[tenant,project]);assert.equal((await candidates()).rows.length,1)
 assert.equal((await db.query('select * from lv_idle_analysis_candidate($1,$2,$3)',[tenant,project,[]])).rows.length,0)
 await db.exec(`update messages set sent_at=now()-interval '10 minutes';update leads set handoff_status='assigned',seller_response_due_at=now()-interval '1 minute';`);assert.equal((await candidates()).rows.length,1)
 await db.exec(`insert into lead_conversation_analyses(conversation_id,created_at,source_last_message_at,analysis) values('${conversation}',now(),now()-interval '10 minutes','{"version":2,"operational_snapshot":{"signals":[{"key":"advisor_overdue"}]}}');`);assert.equal((await candidates()).rows.length,0)
 await db.exec(`insert into lv_integration_events(tenant_id,project_id,status,result,payload,received_at) values('${tenant}','${project}','cancelled','{"requires_review":true}','{"kommoId":12345}',now()+interval '1 second');`);assert.equal((await candidates()).rows.length,1)
 await db.exec(`insert into lv_integration_events(tenant_id,project_id,kind,status,payload) values('${tenant}','${project}','inbound','pending','{"kommoId":12345}');`);assert.equal((await candidates()).rows.length,0)
 await db.exec(`insert into leads(id,tenant_id,project_id,kommo_id) values('40000000-0000-4000-8000-000000000002','${tenant}','${project}',67890);
 insert into conversations values('50000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002',now()-interval '30 hours');
 insert into messages values(gen_random_uuid(),'50000000-0000-4000-8000-000000000002',now()-interval '30 hours');`)
 assert.equal((await candidates()).rows[0].lead_id,'40000000-0000-4000-8000-000000000002','an inbound for one contact does not starve all analysis candidates')
 assert.equal((await db.query('select * from lv_idle_analysis_candidate($1,$2,$3)',[tenant,project,[lead]])).rows.length,0,'the test boundary still excludes the other contact')
})
