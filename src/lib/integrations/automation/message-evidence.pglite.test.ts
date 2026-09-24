import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
test('isolated journal: idempotent, keeps source time/media/author, no commercial effects, strict identities and ACL',async()=>{
  const db=new PGlite(),tenant='a1b2c3d4-0001-4000-8000-000000000001',project='b1b2c3d4-0001-4000-8000-000000000001',lead='10000000-0000-4000-8000-000000000001'
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table tenants(id uuid primary key);create table projects(id uuid primary key);
      create table leads(id uuid primary key,tenant_id uuid,kommo_id bigint,contact_id text,bot_enabled boolean default true);
      insert into tenants values('${tenant}');insert into projects values('${project}');
      insert into leads(id,tenant_id,kommo_id,contact_id) values('${lead}','${tenant}',20,'10');
      grant usage on schema public to service_role;grant select on leads to service_role;`)
    // Match Supabase's real default grants: a narrower GRANT alone cannot remove them.
    await db.exec('alter default privileges in schema public grant all on tables to anon, authenticated, service_role')
    await db.exec(readFileSync('supabase/migrations/20260923174920_kommo_message_evidence.sql','utf8'))
    for(const table of ['kommo_message_evidence','crm_contact_classifications']){
      for(const privilege of ['UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
        assert.equal((await db.query<{allowed:boolean}>('select has_table_privilege($1,$2,$3) as allowed',['service_role',table,privilege])).rows[0].allowed,false)
      }
    }
    assert.equal((await db.query<{allowed:boolean}>("select has_table_privilege('service_role','crm_contact_classifications','INSERT') as allowed")).rows[0].allowed,false)
    const event={externalId:'m1',contactId:10,kommoId:20,chatId:'c1',talkId:'t1',direction:'outgoing',authorType:'bot',sentAt:'2026-09-01T10:00:00Z',source:'history',deliveryStatus:'sent',mediaType:'voice',text:''}
    const save=async(value:unknown)=>db.query('select lv_record_message_evidence($1::jsonb) as inserted',[JSON.stringify([value])])
    await db.exec('set role service_role')
    assert.equal((await save(event)).rows[0].inserted,1)
    assert.equal((await save(event)).rows[0].inserted,0)
    await save({...event,externalId:'conflict',kommoId:21})
    const rows=await db.query<{external_message_id:string;lead_id:string|null;media_type:string;author_type:string}>('select * from kommo_message_evidence order by external_message_id')
    assert.equal(rows.rows[0].lead_id,null)
    assert.equal(rows.rows[1].lead_id,lead)
    assert.equal(rows.rows[1].media_type,'voice')
    assert.equal(rows.rows[1].author_type,'bot')
    assert.equal((await db.query('select bot_enabled from leads')).rows[0].bot_enabled,true)
    await db.query('select classify_crm_contact($1,$2,$3,$4,$5)',[tenant,lead,'internal','Confirmed by owner','audit-request'])
    await db.query('select classify_crm_contact($1,$2,$3,$4,$5)',[tenant,lead,'internal','Confirmed again','audit-request'])
    assert.equal((await db.query('select * from crm_contact_classifications')).rows.length,1)
    await db.query('select classify_crm_contact($1,$2,$3,$4,$5)',[tenant,lead,'commercial','Correction','audit-request'])
    assert.equal((await db.query('select * from crm_contact_classifications')).rows.length,2)
    await db.exec('reset role')
    // Load the actual existing receivers; only their table dependencies are fixtures.
    await db.exec(`create table lv_integration_events(
      id uuid default gen_random_uuid(),tenant_id uuid,project_id uuid,event_key text,
      kind text,contact_key text,payload jsonb,available_at timestamptz,
      unique(project_id,event_key)); alter table leads add column project_id uuid; alter table leads add column updated_at timestamptz;`)
    for(const [file,name] of [
      ['20260909180000_kommo_app_runtime.sql','lv_app_receive'],
      ['20260920120000_advisor_manual_takeover_notifications.sql','lv_app_receive_advisor_outbound'],
    ]){
      const sql=readFileSync('supabase/migrations/'+file,'utf8')
      const definition=sql.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION public\\.'+name+'\\(p_events jsonb\\)[\\s\\S]*?\\$(?:function)?\\$;','i'))
      assert.ok(definition,'real receiver definition must be present')
      await db.exec(definition[0])
    }
    await db.exec('set role service_role')
    const atomic=(e:unknown[],incoming:unknown[],advisor:unknown[])=>db.query('select lv_receive_kommo_observation($1::jsonb,$2::jsonb,$3::jsonb) result',[JSON.stringify(e),JSON.stringify(incoming),JSON.stringify(advisor)])
    const original={...event,externalId:'atomic-message'}
    const inbound={externalId:'atomic-message',contactId:10,kommoId:20}
    // A later inbox failure rolls back BOTH the evidence and the incoming event.
    await assert.rejects(atomic([original],[inbound],[{externalId:'bad',contactId:10}]))
    assert.equal((await db.query("select * from kommo_message_evidence where external_message_id='atomic-message'")).rows.length,0)
    assert.equal((await db.query('select * from lv_integration_events')).rows.length,0)
    // Evidence failure likewise cannot enqueue business work.
    await assert.rejects(atomic([{...original,source:'invalid'}],[inbound],[]))
    assert.equal((await db.query('select * from lv_integration_events')).rows.length,0)
    const advisor={externalId:'advisor-message',contactId:10,kommoId:20,userId:9}
    await atomic([original],[inbound],[advisor]) // Simulate commit whose HTTP response was lost.
    const retried=await atomic([original],[inbound],[advisor])
    assert.deepEqual(retried.rows[0].result,{evidence_inserted:0,inbound_inserted:0,advisor_inserted:0})
    assert.equal((await db.query('select * from lv_integration_events')).rows.length,2)
    assert.equal((await db.query("select * from kommo_message_evidence where external_message_id='atomic-message'")).rows.length,1)
    // Parallel observer first; the normal receiver later sees the same original ID.
    // The observer never creates an inbox event, and either receiver may retry.
    const parallel={...event,externalId:'parallel-incoming',direction:'incoming',source:'webhook',deliveryStatus:'unknown'}
    await save(parallel)
    assert.equal((await db.query('select * from lv_integration_events')).rows.length,2)
    const normal=await atomic([parallel],[{...inbound,externalId:'parallel-incoming'}],[])
    assert.deepEqual(normal.rows[0].result,{evidence_inserted:0,inbound_inserted:1,advisor_inserted:0})
    assert.equal((await save(parallel)).rows[0].inserted,0)
    const again=await atomic([parallel],[{...inbound,externalId:'parallel-incoming'}],[])
    assert.deepEqual(again.rows[0].result,{evidence_inserted:0,inbound_inserted:0,advisor_inserted:0})
    assert.equal((await db.query("select * from kommo_message_evidence where external_message_id='parallel-incoming'")).rows.length,1)
    await db.exec('reset role')
    for(const role of ['anon','authenticated']){
      const acl=await db.query<{allowed:boolean}>('select has_function_privilege($1,\'public.lv_record_message_evidence(jsonb)\',\'EXECUTE\') as allowed',[role])
      assert.equal(acl.rows[0].allowed,false)
      assert.equal((await db.query<{allowed:boolean}>("select has_function_privilege($1,'public.lv_receive_kommo_observation(jsonb,jsonb,jsonb)','EXECUTE') as allowed",[role])).rows[0].allowed,false)
      assert.equal((await db.query<{allowed:boolean}>('select has_table_privilege($1,\'public.kommo_message_evidence\',\'SELECT\') as allowed',[role])).rows[0].allowed,false)
    }
  }finally{await db.close()}
})
