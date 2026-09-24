import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, after, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const tenant='10000000-0000-4000-8000-000000000001'
const project='20000000-0000-4000-8000-000000000001'
const otherProject='20000000-0000-4000-8000-000000000002'
const unit='30000000-0000-4000-8000-000000000001'
const otherUnit='30000000-0000-4000-8000-000000000002'
const user='40000000-0000-4000-8000-000000000001'
let db:PGlite
const targets=[{unitId:unit,externalLabel:null}]
async function save(ad:string,properties:unknown,expected:string[]=[],actor:string|null=user){
  const result=await db.query<{ids:string[]}>(`select public.replace_meta_ad_promoted_properties($1,$2,'act_123',$3,$4::jsonb,$5::uuid[],$6,$7) as ids`,[tenant,project,ad,JSON.stringify(properties),expected,actor,'Confirmado en prueba aislada'])
  return result.rows[0].ids
}
describe('atomic property persistence — isolated PostgreSQL (PGlite), no remote writes',()=>{
  before(async()=>{
    db=new PGlite()
    await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);
      CREATE TABLE public.tenants(id uuid primary key);
      CREATE TABLE public.projects(id uuid primary key,tenant_id uuid);
      CREATE TABLE public.units(id uuid primary key,tenant_id uuid,project_id uuid);
      INSERT INTO auth.users VALUES('${user}');INSERT INTO tenants VALUES('${tenant}');
      INSERT INTO projects VALUES('${project}','${tenant}'),('${otherProject}','${tenant}');
      INSERT INTO units VALUES('${unit}','${tenant}','${project}'),('${otherUnit}','${tenant}','${otherProject}');
      GRANT USAGE ON SCHEMA public TO service_role;
      GRANT SELECT ON projects,units TO service_role;`)
    for(const file of ['20260922230000_meta_ad_promoted_units.sql','20260923150000_lockdown_meta_ad_promoted_units.sql','20260923163750_atomic_ad_property_identification.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'))
  })
  after(async()=>{await db?.close()})
  it('persists a unit, reloads it, and preserves the old confirmation on correction',async()=>{
    const ids=await save('12345',targets)
    const loaded=await db.query<{unit_id:string}>(`select unit_id from meta_ad_promoted_units where ad_id='12345' and superseded_at is null`)
    assert.equal(loaded.rows[0].unit_id,unit)
    const next=await save('12345',[{unitId:null,externalLabel:'Casa externa'}],ids)
    assert.notDeepEqual(next,ids)
    const history=await db.query<{external_label:string|null;superseded_at:string|null}>(`select external_label,superseded_at from meta_ad_promoted_units where ad_id='12345' order by assigned_at`)
    assert.equal(history.rows.length,2)
    assert.ok(history.rows[0].superseded_at)
    assert.equal(history.rows[1].external_label,'Casa externa')
    assert.equal(history.rows[1].superseded_at,null)
    assert.deepEqual(await save('12345',[{unitId:null,externalLabel:'Casa externa'}],next),next)
    assert.equal((await db.query(`select id from meta_ad_promoted_units where ad_id='12345'`)).rows.length,2)
  })
  it('rejects stale edits, invalid units, missing users and duplicates atomically',async()=>{
    const ids=await save('22345',targets)
    await assert.rejects(save('22345',[{unitId:null,externalLabel:'External'}],[]),/property_relation_changed/)
    await assert.rejects(save('22345',[{unitId:otherUnit,externalLabel:null}],ids),/unit_not_in_tenant_project/)
    await assert.rejects(save('22345',targets,ids,null),/authenticated_actor_required/)
    await assert.rejects(save('22345',[{unitId:null,externalLabel:'External'}],ids,'99999999-0000-4000-8000-000000000001'),/foreign key constraint/)
    await assert.rejects(save('22345',[targets[0],targets[0]],ids),/duplicate_property/)
    const unchanged=await db.query<{id:string;superseded_at:string|null}>(`select id,superseded_at from meta_ad_promoted_units where ad_id='22345'`)
    assert.equal(unchanged.rows.length,1);assert.equal(unchanged.rows[0].id,ids[0]);assert.equal(unchanged.rows[0].superseded_at,null)
  })
  it('stores a mixed group together, without duplicating a repeated confirmation',async()=>{
    const properties=[targets[0],{unitId:null,externalLabel:'Externa'}]
    const ids=await save('32345',properties)
    assert.equal(ids.length,2)
    const again=await save('32345',properties,ids)
    assert.deepEqual([...again].sort(),[...ids].sort())
    assert.equal((await db.query(`select id from meta_ad_promoted_units where ad_id='32345'`)).rows.length,2)
  })
  it('preserves RLS and blocks anonymous/authenticated SQL access and RPC calls',async()=>{
    const state=await db.query<{relrowsecurity:boolean;policies:number}>(`select relrowsecurity,(select count(*)::int from pg_policy where polrelid=c.oid) policies from pg_class c where oid='public.meta_ad_promoted_units'::regclass`)
    assert.deepEqual(state.rows[0],{relrowsecurity:true,policies:0})
    for(const role of ['anon','authenticated']){
      await db.exec(`SET ROLE ${role}`)
      try {
        await assert.rejects(db.query('select * from public.meta_ad_promoted_units'),/permission denied/)
        await assert.rejects(save('42345',targets),/permission denied/)
      } finally {await db.exec('RESET ROLE')}
    }
    await db.exec('SET ROLE service_role')
    try {assert.equal((await save('52345',targets)).length,1)} finally {await db.exec('RESET ROLE')}
  })
})
