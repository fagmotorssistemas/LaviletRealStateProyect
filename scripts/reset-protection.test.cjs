const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs')
const {PGlite}=require('@electric-sql/pglite')
require('./test-typescript.cjs')
const {assertProductionRpcAllowed,assertProductionRequestAllowed}=require('../src/lib/integrations/automation/reset-protection.ts')
test('browser/server requests block retired reset RPCs before network',async()=>{
  const {fetchWithTimeout}=require('../src/lib/supabase/request.ts')
  for(const name of ['lv_reset_lavilet_test_contact','lv_reset_lavilet_test_lead','lv_reset_lavilet_nataly_lead','lv_reset_lavilet_pablo_lead','lv_test_reset']){
    assert.throws(()=>assertProductionRpcAllowed(name),/DESTRUCTIVE_TEST_RESET_DISABLED/)
    const url='https://example.supabase.co/rest/v1/rpc/'+name
    assert.throws(()=>assertProductionRequestAllowed(new Request(url)),/DESTRUCTIVE_TEST_RESET_DISABLED/)
    await assert.rejects(fetchWithTimeout(url),/DESTRUCTIVE_TEST_RESET_DISABLED/)
  }
  assert.doesNotThrow(()=>assertProductionRpcAllowed('lv_app_receive'))
})
test('database blocks even owner calls and preserves backups; production roles cannot execute',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table lv_manual_test_reset_backups(id int); insert into lv_manual_test_reset_backups values(1);
      create table lv_test_backups(id int); insert into lv_test_backups values(2);
      create table messages(id int); insert into messages values(3);
      create function lv_reset_lavilet_test_contact(p_kommo_id integer) returns jsonb language sql as $$ delete from messages returning '{}'::jsonb $$;
      create function lv_reset_lavilet_test_lead() returns jsonb language sql as $$select lv_reset_lavilet_test_contact(1)$$;
      create function lv_reset_lavilet_nataly_lead() returns jsonb language sql as $$select lv_reset_lavilet_test_contact(2)$$;
      create function lv_reset_lavilet_pablo_lead() returns jsonb language sql as $$select lv_reset_lavilet_test_contact(3)$$;
      create function lv_test_reset(p_reason text default 'test') returns text language sql as $$select 'old'::text$$;`)
    await db.exec(fs.readFileSync('supabase/migrations/20260923205830_disable_destructive_contact_resets.sql','utf8'))
    for(const call of ['lv_reset_lavilet_test_contact(1)','lv_reset_lavilet_test_lead()','lv_reset_lavilet_nataly_lead()','lv_reset_lavilet_pablo_lead()',"lv_test_reset('test')"]){
      await assert.rejects(db.query('select '+call),/DESTRUCTIVE_TEST_RESET_DISABLED/)
    }
    for(const table of ['lv_manual_test_reset_backups','lv_test_backups']){
      for(const sql of [`delete from ${table}`,`update ${table} set id=9`,`truncate ${table}`])await assert.rejects(db.exec(sql),/RESET_BACKUP_IMMUTABLE/)
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,1)
    }
    assert.equal((await db.query('select count(*)::int n from messages')).rows[0].n,1)
    for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("select has_function_privilege($1,'lv_test_reset(text)','execute') allowed",[role])).rows[0].allowed,false)
  }finally{await db.close()}
})
