/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS executes the isolated PostgreSQL migration fixture. */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const migration = fs.readFileSync('supabase/migrations/20261014180000_urgent_reservation_notifications.sql','utf8')
const lead='10000000-0000-4000-8000-000000000001', advisor='20000000-0000-4000-8000-000000000001'
const tenant='30000000-0000-4000-8000-000000000001', project='40000000-0000-4000-8000-000000000001'
const request='50000000-0000-4000-8000-000000000001', unit='60000000-0000-4000-8000-000000000001'
async function fixture(t, assigned=true) {
 const db=new PGlite();t.after(()=>db.close())
 await db.exec(`create role anon;create role authenticated;
 create table profiles(id uuid primary key,is_active boolean);
 create table project_salespeople(tenant_id uuid,project_id uuid,salesperson_id uuid);
 create table leads(id uuid primary key,tenant_id uuid,project_id uuid,assigned_to uuid,name text,kommo_id bigint,status text default 'nuevo',updated_at timestamptz default now(),handoff_assigned_at timestamptz,handoff_reason text);
 create table units(id uuid,tenant_id uuid,project_id uuid,unit_number text);
 create table lead_reservation_requests(id uuid primary key,lead_id uuid,unit_ids jsonb,created_at timestamptz default now());
 create table advisor_notifications(id uuid primary key default gen_random_uuid(),tenant_id uuid,project_id uuid,recipient_id uuid,lead_id uuid,kind text not null check(kind in ('lead_assigned')),title text,body text,assignment_at timestamptz,metadata jsonb,read_at timestamptz,created_at timestamptz default now(),constraint advisor_notifications_assignment_uq unique(lead_id,recipient_id,assignment_at));
 insert into profiles values('${advisor}',true);
 insert into project_salespeople values('${tenant}','${project}','${advisor}');
 insert into units values('${unit}','${tenant}','${project}','502');
 insert into leads(id,tenant_id,project_id,assigned_to,name,kommo_id) values('${lead}','${tenant}','${project}',${assigned?`'${advisor}'`:'null'},'Carlos',4454162);`)
 await db.exec(migration)
 await db.exec(`create trigger notify_lead_assignment after insert or update of assigned_to,handoff_assigned_at on leads for each row execute function lv_notify_lead_assignment();`)
 return db
}
test('new reservation requests alert an existing owner, distinguish requests, and never duplicate on reassignment replay',async t=>{
 const db=await fixture(t)
 await db.exec(`insert into lead_reservation_requests values('${request}','${lead}','["${unit}"]',now());`)
 let rows=(await db.query('select * from advisor_notifications')).rows
 assert.equal(rows.length,1);assert.equal(rows[0].kind,'reservation_requested');assert.equal(rows[0].recipient_id,advisor)
 assert.match(rows[0].body,/solicitó iniciar una reserva.*502/)
 await db.exec(`update leads set assigned_to=null where id='${lead}';update leads set assigned_to='${advisor}' where id='${lead}';`)
 rows=(await db.query("select * from advisor_notifications where kind='reservation_requested'")).rows
 assert.equal(rows.length,1)
 assert.equal((await db.query('select status from leads')).rows[0].status,'nuevo')
 await db.exec(`delete from lead_reservation_requests where id='${request}'`)
 assert.equal((await db.query("select count(*)::int n from advisor_notifications where kind='reservation_requested'")).rows[0].n,0)
})
test('queued requests alert only after real ownership; confirmation is a distinct event and a metadata update does not repeat it',async t=>{
 const db=await fixture(t,false)
 await db.exec(`insert into lead_reservation_requests values('${request}','${lead}','[]',now());`)
 assert.equal((await db.query('select * from advisor_notifications')).rows.length,0)
 await db.exec(`update leads set assigned_to='${advisor}' where id='${lead}';update leads set status='reservado' where id='${lead}';update leads set status='reservado',updated_at=now() where id='${lead}';`)
 const rows=(await db.query('select kind,count(*)::int n from advisor_notifications group by kind')).rows
 assert.equal(rows.find(r=>r.kind==='reservation_requested').n,1)
 assert.equal(rows.find(r=>r.kind==='reservation_confirmed').n,1)
 assert.equal(rows.find(r=>r.kind==='lead_assigned').n,1)
})
test('installation does not replay old requests and a foreign project advisor is not notified',async t=>{
 const db=await fixture(t)
 assert.equal((await db.query('select * from advisor_notifications')).rows.length,0)
 await db.exec(`update project_salespeople set project_id='40000000-0000-4000-8000-000000000099';insert into lead_reservation_requests values('${request}','${lead}','[]',now());`)
 assert.equal((await db.query('select * from advisor_notifications')).rows.length,0)
})
