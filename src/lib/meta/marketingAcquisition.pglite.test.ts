import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { firstAdOrigins } from './firstAdAcquisition'

const tenant='10000000-0000-4000-8000-000000000001'
const project='20000000-0000-4000-8000-000000000001'

test('simulated inbound persistence: same verified phone, two Kommo identities/ads, one acquisition',async()=>{
  const db=new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE tenants(id uuid primary key); CREATE TABLE projects(id uuid primary key,tenant_id uuid);
      CREATE TABLE leads(id uuid primary key default gen_random_uuid(),tenant_id uuid,project_id uuid,
        name text,phone text,phone_normalized text,source text,source_campaign text,contact_id text,kommo_id integer,
        channel_origin text,last_interaction_at timestamptz,tracking_consent boolean,tracking_consent_at timestamptz,
        updated_at timestamptz,created_at timestamptz default now(),bot_enabled boolean default true,stage text default 'nuevo');
      CREATE UNIQUE INDEX lead_phone ON leads(tenant_id,phone_normalized) WHERE phone_normalized IS NOT NULL;
      CREATE TABLE conversations(id uuid primary key default gen_random_uuid(),tenant_id uuid,project_id uuid,lead_id uuid,
        channel text,external_thread_id text,status text,last_message_at timestamptz);
      CREATE UNIQUE INDEX conv_thread ON conversations(tenant_id,channel,external_thread_id) WHERE external_thread_id IS NOT NULL;
      CREATE TABLE messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,role text,content text,
        external_message_id text unique,sent_at timestamptz);
      INSERT INTO tenants VALUES('${tenant}'); INSERT INTO projects VALUES('${project}','${tenant}');
      GRANT SELECT ON leads,projects,conversations,messages TO service_role;`)
    await db.exec(readFileSync('scripts/fixtures/inbound-identity-20260923.sql','utf8'))
    await db.exec(readFileSync('supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql','utf8'))
    await db.exec(readFileSync('supabase/migrations/20260923163751_marketing_ad_interactions.sql','utf8'))
    const enter=async(phone:string,contact:string,message:string,ad:string,occurred:string)=>{
      const result=await db.query<{lead_id:string}>(`select * from register_inbound_message($1,$2,$3,'Nombre de prueba','waba','whatsapp',null,$4,123,$5,'Consulta',false)`,[tenant,project,phone,contact,message])
      const lead=result.rows[0].lead_id
      await db.query(`select record_marketing_ad_interaction($1,$2,$3,$4,$5,$6,null,$7)`,[tenant,project,lead,contact,message,ad,occurred])
      await db.query(`select lv_app_preserve_ctwa($1,$2,$3,123,$4,'referral',$5,null,'ad',$6)`,[tenant,project,contact,'click-'+message,ad,message])
      return lead
    }
    const first=await enter('+593 99 123 4567','101','message-a','12345','2026-09-20T12:00:00Z')
    const second=await enter('0991234567','202','message-b','67890','2026-09-19T12:00:00Z')
    assert.equal(first,second,'incoming identity reuses the actual ficha, not a display-only deduplication')
    await enter('+593991234567','202','message-b','67890','2026-09-19T12:00:00Z')
    assert.equal((await db.query('select id from leads')).rows.length,1)
    assert.equal((await db.query('select id from messages')).rows.length,2)
    // Supabase returns timestamp text with microseconds; PGlite's default Date decoder drops them.
    const origins=(await db.query<{lead_id:string;ad_id:string;recorded_at:string;id:string}>(`select lead_id,ad_id,recorded_at::text,id from marketing_ad_interactions`)).rows
    assert.equal(origins.length,2,'reload keeps both interactions, retry does not add a third')
    const firstByLead=firstAdOrigins(origins.map(o=>({leadId:o.lead_id,adId:o.ad_id,recordedAt:o.recorded_at,key:o.id,sourceUrl:null})))
    assert.equal(firstByLead.size,1)
    assert.equal(firstByLead.get(first)?.adId,'12345','later saved interaction cannot overwrite first origin, even with older event date')
    assert.equal((await db.query<{ctwa_clid:string}>(`select ctwa_clid from lv_whatsapp_ctwa_attribution where contact_id='101'`)).rows[0].ctwa_clid,'click-message-a')
    const different=await enter('+593991234568','303','message-c','67890','2026-09-21T12:00:00Z')
    assert.notEqual(first,different,'same name with a different phone stays separate')
    await assert.rejects(db.query(`select record_marketing_ad_interaction($1,$2,$3,'101','message-a','99999',null,now())`,[tenant,project,first]),/ad_interaction_conflict/)
    await assert.rejects(db.query(`select record_marketing_ad_interaction($1,$2,$3,'101','message-a','12345',null,now())`,[tenant,project,different]),/scope_mismatch/)
    for(const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`)
      try {await assert.rejects(db.query('select * from marketing_ad_interactions'),/permission denied/)}
      finally {await db.exec('RESET ROLE')}
    }
    await db.exec('SET ROLE service_role')
    await db.query(`select record_marketing_ad_interaction($1,$2,$3,'101','message-a','12345',null,now())`,[tenant,project,first])
  } finally {await db.close()}
})
