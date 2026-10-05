/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')

test('durable conversation claims serialize one contact, run three contacts, and exclude the backup worker', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.lv_integration_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid,project_id uuid,event_key text,kind text,status text DEFAULT 'pending',contact_key text,
      payload jsonb DEFAULT '{}',result jsonb,received_at timestamptz DEFAULT now(),available_at timestamptz DEFAULT now(),
      claimed_at timestamptz,claim_token uuid,lease_until timestamptz,completed_at timestamptz,
      UNIQUE(project_id,event_key));`)
    const base = readFileSync('supabase/migrations/20260909180000_kommo_app_runtime.sql','utf8')
    const finish = base.slice(base.indexOf('CREATE FUNCTION public.lv_app_finish'), base.indexOf('REVOKE ALL ON FUNCTION public.lv_app_worker_lock'))
    await db.exec(readFileSync('supabase/migrations/20261005200000_conversation_workers.sql','utf8'))
    await db.exec(finish)
    const scalar = async (sql, params=[]) => Object.values((await db.query(sql,params)).rows[0])[0]
    const lock = (token,contact) => scalar('SELECT lv_app_contact_lock($1,$2)',[token,contact])
    const global = (token,action) => scalar('SELECT lv_app_worker_lock($1,$2)',[token,action])
    const claim = async (token,contact) => (await db.query('SELECT * FROM lv_app_claim_contact($1,$2)',[token,contact])).rows
    let eventOrder=0
    const add = async (contact,kind='inbound',delay='-1 second',media=false) => {
      const id=randomUUID()
      await db.query(`INSERT INTO lv_integration_events(id,tenant_id,project_id,event_key,kind,contact_key,available_at,payload,received_at)
        VALUES($1::uuid,'a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001',$1::text,$2,$3,now()+$4::interval,$5::jsonb,$6)`,[id,kind,contact,delay,JSON.stringify(media?{media:{type:'image'}}:{}),new Date(Date.UTC(2026,9,5)+eventOrder++*1000).toISOString()])
      return id
    }
    const a=randomUUID(),b=randomUUID(),c=randomUUID(),d=randomUUID(),backup=randomUUID()
    assert.equal(await global(backup,'acquire'),true)
    assert.equal(await lock(a,'A'),false)
    await global(backup,'release')
    assert.equal(await lock(a,'A'),true)
    assert.equal(await lock(b,'A'),false)
    assert.equal(await lock(b,'B'),true)
    assert.equal(await lock(c,'C'),true)
    assert.equal(await lock(d,'D'),false)
    assert.equal(await global(backup,'acquire'),false)
    const first=await add('A'),last=await add('A','inbound','30 seconds')
    assert.equal((await scalar('SELECT lv_app_contact_wakeup($1)',['A'])).event_id,last)
    assert.deepEqual(await claim(a,'A'),[])
    const other=await add('B')
    assert.deepEqual((await claim(b,'B')).map(r=>r.id),[other])
    await db.query(`UPDATE lv_integration_events SET available_at=now()-interval '1 second' WHERE id=$1`,[last])
    assert.deepEqual((await claim(a,'A')).map(r=>r.id),[first,last])
    assert.equal(await scalar('SELECT status FROM lv_integration_events WHERE id=$1',[other]),'processing')
    assert.deepEqual(await claim(a,'A'),[])
    await assert.rejects(claim(c,'A'),/contact lease lost/)
    await scalar(`SELECT lv_app_finish($1,$2::uuid[],'completed','{}')`,[a,[first,last]])
    assert.equal(await scalar('SELECT lv_app_contact_wakeup($1)',['A']),null)
    await global(a,'release')
    assert.equal(await lock(d,'D'),true)
    // Human messages are handled before inbound and never join its batch.
    const inbound=await add('D'),advisor=await add('D','advisor_outbound')
    assert.deepEqual((await claim(d,'D')).map(r=>r.id),[advisor])
    await scalar(`SELECT lv_app_finish($1,$2::uuid[],'completed','{}')`,[d,[advisor]])
    assert.deepEqual((await claim(d,'D')).map(r=>r.id),[inbound])
    // A crashed send becomes uncertain for this contact; no replay or damage to B.
    await db.query(`UPDATE lv_integration_events SET lease_until=now()-interval '1 second' WHERE claim_token=$1 AND kind='lock'`,[d])
    const replacement=randomUUID()
    assert.equal(await lock(replacement,'D'),true)
    assert.deepEqual(await claim(replacement,'D'),[])
    assert.equal(await scalar('SELECT status FROM lv_integration_events WHERE id=$1',[inbound]),'uncertain')
    assert.equal(await scalar('SELECT status FROM lv_integration_events WHERE id=$1',[other]),'processing')
    assert.equal(await scalar('SELECT lv_app_contact_wakeup($1)',['D']),null)
    assert.equal(await global(d,'renew'),false)
    for(const token of [b,c,replacement]) await global(token,'release')
    assert.equal(await global(backup,'acquire'),true)
  } finally { await db.close() }
})
