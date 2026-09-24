/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS server-action mocks. */
// Exercises real server action/service code; all authentication, Graph and DB I/O is simulated.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const Module = require('node:module')
const path = require('node:path')
const originalLoad = Module._load
const unitId = '30000000-0000-4000-8000-000000000001'
const actor = '40000000-0000-4000-8000-000000000001'
let state
const reset=()=>{state={loggedIn:true,access:true,write:true,tenant:true,project:true,unit:true,account:'act_123',resolved:true,rpc:[],tables:[],filters:[]}}
const admin={
  from(table){
    state.tables.push(table)
    const query={
      select(){return query},eq(key,value){state.filters.push([table,key,value]);return query},
      in(){return query},
      async maybeSingle(){return {data:state.project?{id:'project',tenant_id:'tenant'}:null,error:null}},
      then(resolve){return Promise.resolve({data:state.unit?[{id:unitId}]:[],error:null}).then(resolve)},
    }
    return query
  },
  async rpc(name,args){state.rpc.push({name,args});return {data:['saved'],error:null}},
}
Module._load=function(id,parent,isMain){
  if(id==='@/lib/auth/session') return {
    async assertCanAccessCrmPath(){if(!state.access)throw Error('access denied')},
    async assertCanWriteCrm(){if(!state.write)throw Error('write denied')},
  }
  if(id==='@/lib/inmobiliaria/tenants')return {getAccessibleTenantIds:async()=>state.tenant?['tenant']:[]}
  if(id==='@/lib/supabase/server')return {createClient:async()=>({auth:{getUser:async()=>({data:{user:state.loggedIn?{id:actor}:null}})}})}
  if(id==='@/lib/supabase/admin')return {tryCreateAdminClient:()=>admin}
  if(id==='@/lib/meta/adsMarketingClient')return {
    readAdsMarketingCredentials:()=>({adAccountId:'act_123'}),
    resolveAdHierarchy:async()=>({resolutionStatus:state.resolved?'resolved':'unresolved',adAccountId:state.account}),
    isAdAccountMatch:(a,b)=>a===b,
  }
  if(id==='@/services/marketingFunnel.service')return {}
  return originalLoad.call(this,id,parent,isMain)
}
const {assignPromotedUnitAction}=require(path.resolve('src/app/inmobiliaria/marketing/metricas/actions.ts'))
Module._load=originalLoad
const input=()=>({tenantId:'tenant',projectId:'project',adId:'12345',targets:[{unitId,externalLabel:null}],expectedIds:[],note:'Confirmado por responsable'})
test('authorized action scopes the project/unit and sends a single atomic replacement',async()=>{
  reset()
  assert.equal((await assignPromotedUnitAction(input())).ok,true)
  assert.equal(state.rpc.length,1)
  assert.equal(state.rpc[0].name,'replace_meta_ad_promoted_properties')
  assert.equal(state.rpc[0].args.p_user_id,actor)
  assert.equal(state.rpc[0].args.p_ad_account_id,'act_123')
  assert.deepEqual(state.filters,[['projects','id','project'],['projects','tenant_id','tenant'],['units','tenant_id','tenant'],['units','project_id','project']])
  assert.deepEqual(state.tables,['projects','units'])
})
for(const [condition,value] of [['loggedIn',false],['access',false],['write',false],['tenant',false],['project',false],['unit',false],['account','act_wrong'],['resolved',false]]){
  test(`rejects ${condition} mismatch before persistence`,async()=>{
    reset();state[condition]=value
    assert.equal((await assignPromotedUnitAction(input())).ok,false)
    assert.equal(state.rpc.length,0)
  })
}
test('external confirmation neither writes interests nor moves contacts',async()=>{
  reset()
  const result=await assignPromotedUnitAction({...input(),targets:[{unitId:null,externalLabel:'Casa externa'}]})
  assert.equal(result.ok,true)
  assert.deepEqual(state.tables,['projects'])
  assert.deepEqual(state.rpc[0].args.p_targets,[{unitId:null,externalLabel:'Casa externa'}])
})
test('invalid input cannot manufacture a unit/external relation',async()=>{
  for(const patch of [{targets:[{unitId,externalLabel:'External'}]},{targets:[]},{note:''},{expectedIds:['bad']},{adId:'../../me'}]){
    reset();assert.equal((await assignPromotedUnitAction({...input(),...patch})).ok,false);assert.equal(state.rpc.length,0)
  }
})
