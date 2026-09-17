/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module'),fs=require('node:fs'),ts=require('typescript')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {validateReadiness,projectReadiness,botReadiness,readinessMaterialReply,readinessInvitation}=require('../src/lib/inmobiliaria/projectReadiness.ts')
const {botVisitPolicy,visitInvitation}=require('../src/lib/inmobiliaria/botVisits.ts')
const {acceptsVisitInvitation,ambiguousVisitAcceptance}=require('../src/lib/integrations/automation/sales-policy.ts')
const {visitTruthReply}=require('../src/lib/integrations/automation/visit-copy.ts')
const {protectedSentences}=require('../src/lib/integrations/automation/turn-completeness.ts')
const {botPricingPolicy,launchPricesVisible}=require('../src/lib/inmobiliaria/unitPrices.ts')
const base={stage:'building',progress:'Estructura del segundo piso terminada',verifiedOn:'2026-01-01',enabledPlaces:['office'],primaryPlace:'office',conditions:'Con cita previa',materials:[]}
function loadActions(mocks){const full=path.resolve('src/app/inmobiliaria/automatizacion/proyecto/actions.ts'),m={exports:{}},r=Module.createRequire(full);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(id=>id in mocks?mocks[id]:r(id),m,m.exports);return m.exports}

test('legacy remains unchanged until explicit save; stages never activate prices or invitations',()=>{
  assert.equal(projectReadiness({},'lanzamiento').configured,false)
  for(const mode of ['lanzamiento','preventa'])for(const stage of ['not_started','building','completed','unknown'])for(const visible of [true,false]){
    const policies={bot_pricing:{launch_prices_visible:visible},bot_visits:{allow_suggestions:false},project_readiness:{current:{...base,stage}}}
    assert.equal(botPricingPolicy(mode,launchPricesVisible(policies)).visible,mode==='preventa'||visible)
    assert.equal(visitInvitation(mode,botVisitPolicy(policies,mode)),'')
    assert.equal(projectReadiness(policies,mode).value.stage,stage)
  }
})
test('no destination blocks invitation without destroying suggestion preference',()=>{
  const current={...base,enabledPlaces:[],primaryPlace:'none'}
  assert.deepEqual(validateReadiness(current),current)
  const policy=botVisitPolicy({bot_visits:{allow_suggestions:true},project_readiness:{current}},'preventa')
  assert.equal(policy.allowSuggestions,true)
  assert.equal(visitInvitation('preventa',policy),'')
})
test('brochure does not infer construction status from commercial stage after configuration',()=>{
  const {brochureReply}=require('../src/lib/integrations/automation/project-material.ts')
  assert.doesNotMatch(brochureReply('Envíeme el brochure',[],'lanzamiento',true),/no hay departamentos construidos/)
  assert.match(brochureReply('Envíeme el brochure',[],'lanzamiento',true),/brochure-la-vilet/)
})
test('unapproved materials never enter bot context; renders are labeled and are not progress',()=>{
  const value={...base,materials:[{title:'Privado',url:'https://example.com/private',date:'2026-01-01',kind:'progress',approved:false},{title:'Plano visual',url:'https://example.com/render',date:'2026-01-01',kind:'render',approved:true}]}
  assert.equal(botReadiness(value).materials.length,1)
  assert.match(readinessMaterialReply(value,'Envíeme imágenes'),/Render: representación.*2026-01-01/)
  assert.doesNotMatch(readinessMaterialReply(value,'Envíeme imágenes'),/private/)
  assert.doesNotMatch(readinessMaterialReply(value,'Quiero ver avances de obra'),/example.com/)
  for(const bad of [{...base,verifiedOn:'2026-02-30'},{...base,primaryPlace:'model'},{...base,materials:[{...value.materials[0],url:'javascript:alert(1)'}]}])assert.throws(()=>validateReadiness(bad))
})
test('short acceptance follows one invitation; old ambiguous offers clarify; negatives do not book',()=>{
  const invite=readinessInvitation(base)
  for(const answer of ['Listo, está bien','Sí','Perfecto','Listo'])assert.equal(acceptsVisitInvitation(answer,invite),true,answer)
  assert.equal(acceptsVisitInvitation('No, gracias',invite),false)
  const old='Puedo enviarle imágenes. Si le interesa, puede acercarse a nuestra oficina para conversar.'
  assert.equal(ambiguousVisitAcceptance('Listo, está bien',old),true)
  assert.equal(acceptsVisitInvitation('Listo, está bien',old),false)
  const multiple='¿Prefiere revisar material o coordinar una visita?'
  assert.equal(acceptsVisitInvitation('Sí',multiple),false)
  assert.equal(ambiguousVisitAcceptance('Sí',multiple),true)
  assert.equal(ambiguousVisitAcceptance('Listo, está bien','Le comparto el precio referencial.'),false)
})
test('final guard respects authorized model and replaces unauthorized access',()=>{
  const run=(reply,value)=>visitTruthReply(reply,{estado_proyecto:value,modo_comercial:'preventa'},{},[],protectedSentences)
  assert.match(run('Podemos visitar el terreno.',base),/oficina/)
  const model={...base,enabledPlaces:['model'],primaryPlace:'model'}
  assert.equal(run('Podemos visitar el departamento modelo.',model),'Podemos visitar el departamento modelo.')
  assert.doesNotMatch(run('Podemos visitar los departamentos terminados.',model),/visitar los departamentos terminados/)
  assert.match(run('¿Le gustaría coordinar una visita?',{...base,enabledPlaces:[],primaryPlace:'none'}),/no hay visitas/)
})
test('save retains pricing, visit preference and other policy keys; stale updates are rejected',async()=>{
  const policies={bot_pricing:{launch_prices_visible:true},bot_visits:{allow_suggestions:false},unrelated:{keep:true}}
  const row={id:'project',tenant_id:'tenant',updated_at:'old',policies_json:policies}
  let write,filters=[],adminChecks=0,conflict=false
  const supabase={from:()=>{let updating=false;const q={select:()=>{if(!updating)return q;if(conflict)return Promise.resolve({data:[]});row.updated_at='2026-09-17T22:49:28.964271+00:00';return Promise.resolve({data:[{id:'project',updated_at:row.updated_at}]})},eq:(k,v)=>{filters.push([k,v]);return q},single:async()=>({data:row}),update:v=>{write=v;updating=true;return q}};return q}}
  const api=loadActions({'@/lib/auth/session':{assertAdmin:async()=>{adminChecks++},getSessionUser:async()=>({supabase,user:{id:'admin'}})}})
  const first=await api.saveProjectReadiness('project',base,'old')
  assert.equal(first.ok,true)
  assert.equal(first.updatedAt,row.updated_at)
  assert.equal(adminChecks,1)
  assert.deepEqual(write.policies_json.bot_pricing,policies.bot_pricing)
  assert.equal(write.policies_json.bot_visits.allow_suggestions,false)
  assert.deepEqual(write.policies_json.unrelated,policies.unrelated)
  assert.ok(filters.some(([k,v])=>k==='tenant_id'&&v==='tenant'))
  assert.ok(filters.some(([k,v])=>k==='updated_at'&&v==='old'))
  assert.equal(write.policies_json.project_readiness.history.length,1)
  assert.equal((await api.saveProjectReadiness('project',{...base,stage:'completed'},first.updatedAt)).ok,true)
  write=null;assert.equal((await api.saveProjectReadiness('project',base,'stale')).ok,false);assert.equal(write,null)
  conflict=true;assert.equal((await api.saveProjectReadiness('project',base,row.updated_at)).ok,false)
  const invalid=await api.saveProjectReadiness('project',{...base,verifiedOn:'wrong'},row.updated_at)
  assert.equal(invalid.ok,false);assert.match(invalid.error,/fecha/)
})
