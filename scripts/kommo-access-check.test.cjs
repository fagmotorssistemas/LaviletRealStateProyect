const test=require('node:test'),assert=require('node:assert/strict')
const {checkAccess}=require('./kommo-access-check.cjs')
function fixture({account=36919007,denied=false,empty=false}={}){
  return async path=>{
    if(path==='/api/v4/account')return {id:account}
    if(path.startsWith('/api/v4/leads/'))return {id:4453096,_embedded:{contacts:[{id:9431328}]}}
    if(path.startsWith('/api/v4/contacts/'))return {id:9431328,_embedded:{leads:[{id:4453096}]}}
    if(path.includes('/messages')){if(denied)throw Error('KOMMO_HTTP_403');return {_embedded:{messages:[{id:'m1'}]}}}
    return {_embedded:{talks:empty?[]:[{id:12,contact_id:9431328}]}}
  }
}
test('checks both links and original history endpoint without claiming full audit',async()=>{
  const result=await checkAccess(fixture())
  assert.equal(result.relationship4453096To9431328,true)
  assert.equal(result.history.messages,1)
  assert.equal(result.fullAuditComplete,false)
})
test('rejects a different account',async()=>{await assert.rejects(checkAccess(fixture({account:7})),/WRONG_KOMMO_ACCOUNT/)})
test('403 means inaccessible history, never empty history',async()=>{
  const result=await checkAccess(fixture({denied:true}))
  assert.equal(result.history.accessible,false)
  assert.equal(result.history.error,'KOMMO_HTTP_403')
})
test('no visible talks does not prove history permission',async()=>{
  const result=await checkAccess(fixture({empty:true}))
  assert.equal(result.history.tested,false)
  assert.equal(result.fullAuditComplete,false)
})
