/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL fixture. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{PGlite}=require('@electric-sql/pglite')
const advisor='20000000-0000-4000-8000-000000000001',other='20000000-0000-4000-8000-000000000002',tenant='a1b2c3d4-0001-4000-8000-000000000001',project='b1b2c3d4-0001-4000-8000-000000000001',lead='10000000-0000-4000-8000-000000000001',request='50000000-0000-4000-8000-000000000001'
async function fixture(t,{applyConflictFix=true}={}){const db=new PGlite();t.after(()=>db.close());await db.exec(`
create role anon;create role authenticated;create role service_role;
create table profiles(id uuid primary key,is_active boolean,role text default 'asesor');
create table project_salespeople(id uuid default gen_random_uuid(),tenant_id uuid,project_id uuid,salesperson_id uuid,receives_leads boolean default true,rotation_order int default 0,last_lead_assigned_at timestamptz);
create table project_automation_config(project_id uuid,sla_response_minutes int);
create table leads(id uuid primary key,tenant_id uuid,project_id uuid,assigned_to uuid,name text,kommo_id bigint,status text default 'nuevo',updated_at timestamptz default now(),handoff_requested_at timestamptz,handoff_assigned_at timestamptz,handoff_reason text,handoff_status text default 'queued',seller_response_due_at timestamptz);
create table units(id uuid,tenant_id uuid,project_id uuid,unit_number text,is_published boolean default true);
create table conversations(id uuid primary key,lead_id uuid,status text);
create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,external_message_id text,role text,content text,sent_at timestamptz);
create table bot_escalations(conversation_id uuid,assigned_to uuid,reason text,resolved_at timestamptz);
create table lead_reservation_requests(id uuid primary key default gen_random_uuid(),lead_id uuid,unit_ids jsonb,created_at timestamptz default now(),assignment_mode text,handoff_status text,assigned_to uuid,response_due_at timestamptz,source_message_id text,source_sent_at timestamptz,conversation_id uuid,evidence_message_ids jsonb,evidence text,request_status text default 'requested',unique(lead_id,source_message_id));
create table advisor_notifications(id uuid primary key default gen_random_uuid(),tenant_id uuid,project_id uuid,recipient_id uuid,lead_id uuid,kind text not null check(kind in ('lead_assigned')),title text,body text,assignment_at timestamptz,metadata jsonb,read_at timestamptz,created_at timestamptz default now(),constraint advisor_notifications_assignment_uq unique(lead_id,recipient_id,assignment_at));
create function add_business_minutes(uuid,timestamptz,int) returns timestamptz language sql as 'select $2+make_interval(mins=>$3)';
insert into profiles(id,is_active) values('${advisor}',true),('${other}',false);
insert into project_salespeople(tenant_id,project_id,salesperson_id) values('${tenant}','${project}','${advisor}'),('${tenant}','${project}','${other}');
insert into project_automation_config values('${project}',120);
insert into leads(id,tenant_id,project_id,name,kommo_id) values('${lead}','${tenant}','${project}','Cliente',4454162);`);
await db.exec(fs.readFileSync('supabase/migrations/20261014180000_urgent_reservation_notifications.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261016090000_reservation_assignment_and_alert.sql','utf8'));
if(applyConflictFix)await db.exec(fs.readFileSync('supabase/migrations/20261016110000_fix_lead_assignment_notification_conflict.sql','utf8'));
await db.exec('create trigger notify_lead_assignment after update of assigned_to,handoff_assigned_at on leads for each row execute function lv_notify_lead_assignment()');return db}
async function insert(db){await db.exec(`insert into lead_reservation_requests(id,lead_id,unit_ids,created_at) values('${request}','${lead}','[]','2026-10-16T05:49:00Z')`)}
test('reservation immediately assigns an active eligible advisor outside office hours and creates exactly one urgent alert',async t=>{const db=await fixture(t);await insert(db);const r=(await db.query('select * from lead_reservation_requests')).rows[0];assert.equal(r.assigned_to,advisor);assert.equal(r.handoff_status,'assigned');assert.equal(r.notification_status,'created');assert.equal(r.notified_recipient,advisor);assert.equal((await db.query('select * from advisor_notifications')).rows.length,1);await db.query('select lv_retry_reservation_alerts($1)',[project]);assert.equal((await db.query('select * from advisor_notifications')).rows.length,1);assert.equal((await db.query('select status from leads')).rows[0].status,'nuevo')});
test('no eligible advisor preserves an urgent pending request; re-enabling one allows idempotent automatic recovery',async t=>{const db=await fixture(t);await db.exec('update project_salespeople set receives_leads=false');await insert(db);assert.equal((await db.query('select notification_status from lead_reservation_requests')).rows[0].notification_status,'pending_assignment');assert.equal((await db.query('select * from advisor_notifications')).rows.length,0);await db.exec(`update project_salespeople set receives_leads=true where salesperson_id='${advisor}'`);await db.query('select lv_retry_reservation_alerts($1)',[project]);assert.equal((await db.query('select assigned_to from leads')).rows[0].assigned_to,advisor);assert.equal((await db.query('select * from advisor_notifications')).rows.length,1)});
test('alert failure does not erase a valid request and retry records success',async t=>{const db=await fixture(t);await db.exec("alter table advisor_notifications add constraint simulate_failure check(false)");await insert(db);assert.equal((await db.query('select notification_status from lead_reservation_requests')).rows[0].notification_status,'failed');await db.exec('alter table advisor_notifications drop constraint simulate_failure');await db.query('select lv_retry_reservation_alerts($1)',[project]);assert.equal((await db.query('select notification_status from lead_reservation_requests')).rows[0].notification_status,'created')});
test('recovery is bounded by project and authorized lead ids',async t=>{const db=await fixture(t);await db.exec('update project_salespeople set receives_leads=false');await insert(db);await db.exec('update project_salespeople set receives_leads=true');await db.query('select lv_retry_reservation_alerts($1,$2)',[project,[]]);assert.equal((await db.query('select assigned_to from leads')).rows[0].assigned_to,null)});
test('rotation distributes different reservation leads and keeps an eligible existing owner',async t=>{
 const db=await fixture(t),secondLead='10000000-0000-4000-8000-000000000002',secondRequest='50000000-0000-4000-8000-000000000002';
 await db.exec(`update profiles set is_active=true;update project_salespeople set rotation_order=1 where salesperson_id='${other}'`);await insert(db);
 await db.exec(`insert into leads(id,tenant_id,project_id,name) values('${secondLead}','${tenant}','${project}','Segundo cliente');insert into lead_reservation_requests(id,lead_id,unit_ids) values('${secondRequest}','${secondLead}','[]')`);
 assert.equal((await db.query('select assigned_to from leads where id=$1',[lead])).rows[0].assigned_to,advisor);assert.equal((await db.query('select assigned_to from leads where id=$1',[secondLead])).rows[0].assigned_to,other);
 await db.query('select lv_assign_reservation_owner($1)',[lead]);assert.equal((await db.query('select assigned_to from leads where id=$1',[lead])).rows[0].assigned_to,advisor);
});
test('an active account outside advisor/admin roles cannot receive a reservation',async t=>{const db=await fixture(t);await db.exec("update profiles set role='marketing'");await insert(db);assert.equal((await db.query('select assigned_to from leads')).rows[0].assigned_to,null);assert.equal((await db.query('select notification_status from lead_reservation_requests')).rows[0].notification_status,'pending_assignment')});
test('confirmed reservation remains a distinct urgent event for its owner even if new-lead rotation is paused',async t=>{const db=await fixture(t);await insert(db);await db.exec(`update project_salespeople set receives_leads=false;update leads set status='reservado' where id='${lead}'`);const kinds=(await db.query('select kind from advisor_notifications')).rows.map(row=>row.kind);assert.equal(kinds.filter(kind=>kind==='reservation_confirmed').length,1);assert.equal(kinds.filter(kind=>kind==='reservation_requested').length,1)});

test('the real intake RPC keeps receipt, unresolved escalation and urgent recipient aligned; failed alerts never erase the request',async t=>{
 const db=await fixture(t),conversation='60000000-0000-4000-8000-000000000001';
 await db.exec(`insert into conversations(id,lead_id) values('${conversation}','${lead}');insert into messages(conversation_id,external_message_id,role,content,sent_at) values('${conversation}','incoming-1','cliente','Quiero reservar el 605',now());alter table advisor_notifications add constraint simulate_failure check(false)`);
 const result=await db.query("select lv_request_reservation_handoff($1,'incoming-1','[]','Quiero reservar el 605') receipt",[lead]);
 assert.equal(result.rows[0].receipt.assigned_to,advisor);assert.equal(result.rows[0].receipt.handoff_status,'assigned');
 assert.equal((await db.query('select assigned_to from bot_escalations')).rows[0].assigned_to,advisor);
 assert.equal((await db.query('select notification_status from lead_reservation_requests')).rows[0].notification_status,'failed');
 await db.exec('alter table advisor_notifications drop constraint simulate_failure');await db.query('select lv_retry_reservation_alerts($1)',[project]);
 const replay=await db.query("select lv_request_reservation_handoff($1,'incoming-1','[]','Quiero reservar el 605') receipt",[lead]);
 assert.equal(replay.rows[0].receipt.replayed,true);assert.equal((await db.query('select * from lead_reservation_requests')).rows.length,1);
 const alerts=(await db.query('select kind,recipient_id from advisor_notifications')).rows;assert.deepEqual(alerts,[{kind:'reservation_requested',recipient_id:advisor}]);
});


test('generic handoff reproduces 42P10 before the patch and creates one assignment alert after it',async t=>{
 const db=await fixture(t,{applyConflictFix:false});
 const assignmentAt='2026-10-16T14:48:00Z';
 const assign=()=>db.query('update leads set assigned_to=$1,handoff_assigned_at=$2 where id=$3',[advisor,assignmentAt,lead]);
 await assert.rejects(assign(),error=>error.code==='42P10');
 assert.equal((await db.query('select assigned_to from leads')).rows[0].assigned_to,null);
 await db.exec(fs.readFileSync('supabase/migrations/20261016110000_fix_lead_assignment_notification_conflict.sql','utf8'));
 assert.equal((await db.query('select count(*)::int count from advisor_notifications')).rows[0].count,0);
 await assign();await assign();
 const alerts=(await db.query('select kind,recipient_id from advisor_notifications')).rows;
 assert.deepEqual(alerts,[{kind:'lead_assigned',recipient_id:advisor}]);
 assert.equal((await db.query('select assigned_to from leads')).rows[0].assigned_to,advisor);
});

test('generic assignment and urgent reservation alerts coexist for the same assignment',async t=>{
 const db=await fixture(t);
 await db.query('update leads set assigned_to=$1,handoff_assigned_at=$2 where id=$3',[advisor,'2026-10-16T05:49:00Z',lead]);
 await insert(db);await db.query('select lv_retry_reservation_alerts($1)',[project]);
 const alerts=(await db.query('select kind,recipient_id,assignment_at from advisor_notifications order by kind')).rows;
 assert.deepEqual(alerts.map(({kind,recipient_id})=>({kind,recipient_id})),[
  {kind:'lead_assigned',recipient_id:advisor},{kind:'reservation_requested',recipient_id:advisor},
 ]);
 assert.equal(+alerts[0].assignment_at,+alerts[1].assignment_at);
});
