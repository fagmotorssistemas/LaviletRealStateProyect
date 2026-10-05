import test from 'node:test'
import assert from 'node:assert/strict'
import { addDeliveryMonths, changeProjectDelivery, deliveryContext, emptyProjectDelivery, projectDeliverySettings, validateProjectDelivery, type ProjectDelivery } from './projectDelivery'
import { verifiedClaimSources } from '../integrations/automation/turn-evidence'
import { focusedReviewContext } from '../integrations/automation/focused-review'
import { businessRiskContext } from '../integrations/automation/business-risk-review'
import { compactTurnPromptContext } from '../integrations/automation/turn-prompt-context'

const base:ProjectDelivery={...emptyProjectDelivery(),enabled:true,source:'Responsable comercial'}
const policies=(value:Partial<ProjectDelivery>)=>({project_delivery:{current:{...base,...value}}})
test('there is no fabricated default date; disabled, unknown and invalid settings expose no saved date',()=>{
  assert.equal(projectDeliverySettings({}).configured,false)
  assert.equal(deliveryContext({}).available,false)
  for(const value of [{enabled:false,timing:'year',year:2028},{timing:'unknown',year:2028},{timing:'month',year:2028,month:99}] as Partial<ProjectDelivery>[]){
    const info=deliveryContext(policies(value))
    assert.equal(info.available,false)
    assert.doesNotMatch(JSON.stringify(info),/2028|2099/)
  }
})
test('date, month and year retain their precision and certainty',()=>{
  for(const [value,expected,certainty] of [
    [{timing:'date',date:'2028-02-29',certainty:'confirmed'},'2028-02-29','confirmed'],
    [{timing:'month',year:2028,month:10},'2028-10','estimated'],
    [{timing:'year',year:2028},'2028','estimated'],
  ] as const){
    const info=deliveryContext(policies(value),'2026-10-05')
    assert.equal(info.delivery,expected);assert.equal(info.certainty,certainty)
    assert.equal(info.status,'published')
  }
  assert.match(deliveryContext(policies({timing:'year',year:2028})).statement,/No hay un mes/)
})
test('duration is anchored to the saved date and not to each query date',()=>{
  const input=policies({timing:'duration',months:12,referenceDate:'2026-10-05'})
  const first=deliveryContext(input,'2026-10-05'),later=deliveryContext(input,'2027-03-01')
  assert.equal(first.delivery,'2027-10');assert.equal(later.delivery,first.delivery)
  assert.match(later.statement,/desde el 5 de octubre de 2026/)
  assert.equal(addDeliveryMonths('2027-01-31',1),'2027-02-28')
  assert.equal(addDeliveryMonths('2028-01-31',1),'2028-02-29')
  assert.equal(addDeliveryMonths('2028-02-29',12),'2029-02-28')
})
test('a construction-dependent duration does not invent a start date or calendar delivery',()=>{
  const info=deliveryContext(policies({timing:'duration',months:18,reference:'construction_start'}),'2026-10-05')
  assert.equal(info.delivery,null);assert.match(info.statement,/18 meses desde el inicio/)
  assert.match(info.statement,/No hay una fecha de inicio/)
  const dated=deliveryContext(policies({timing:'duration',months:18,reference:'construction_start',referenceDate:'2026-10-05'}),'2026-10-05')
  assert.equal(dated.delivery,'2028-04')
})
test('a past published period requires updating; the current month or year has not expired prematurely',()=>{
  for(const [value,today,expected] of [
    [{timing:'date',date:'2026-10-05'},'2026-10-06','needs_update'],
    [{timing:'month',month:10,year:2026},'2026-10-31','published'],
    [{timing:'month',month:10,year:2026},'2026-11-01','needs_update'],
    [{timing:'year',year:2026},'2026-12-31','published'],
    [{timing:'year',year:2026},'2027-01-01','needs_update'],
  ] as const)assert.equal(deliveryContext(policies(value),today).status,expected)
})
test('invalid schedules and missing authority cannot be published',()=>{
  for(const value of [{timing:'date',date:'2027-02-29'},{timing:'month',year:2028,month:0},
    {timing:'year',year:2028.5},{timing:'duration',months:12,referenceDate:''},
    {timing:'duration',months:-1,reference:'construction_start'},
    {timing:'year',year:2028,source:''},{timing:'duration',months:1.5,reference:'construction_start'}] as Partial<ProjectDelivery>[])
    assert.throws(()=>validateProjectDelivery({...base,...value}))
})
test('saving and disabling delivery preserve other controls, publication history and stored values',()=>{
  const original={business_policies:{test_items:[{id:'keep'}]},bot_visits:{allow_suggestions:false},test_only:true}
  const active=changeProjectDelivery(original,{...base,timing:'year',year:2028},'admin','2026-10-05')
  const disabled=changeProjectDelivery(active,{...active.project_delivery.current,enabled:false},'admin','2026-10-06')
  assert.deepEqual(disabled.business_policies,original.business_policies)
  assert.deepEqual(disabled.bot_visits,original.bot_visits);assert.equal(disabled.test_only,true)
  assert.equal(disabled.project_delivery.current.year,2028);assert.equal(deliveryContext(disabled).available,false)
  assert.equal(disabled.project_delivery.history.length,2)
})
test('delivery evidence survives prompt compaction and reaches both reviewer contracts',()=>{
  const entrega_proyecto=deliveryContext(policies({timing:'year',year:2028}),'2026-10-05')
  const verified={entrega_proyecto},sources=verifiedClaimSources(verified,{},{} ,'¿Cuándo lo entregan?')
  assert.ok(sources.some(source=>source.kind==='project_fact'&&source.path==='contexto_verificado.entrega_proyecto'))
  const context={contexto_verificado:verified,evidencia_afirmaciones:sources}
  assert.deepEqual(compactTurnPromptContext(context).contexto_verificado,verified)
  assert.deepEqual(focusedReviewContext(context,[]).contexto_verificado,verified)
  const risk=businessRiskContext({verified,current:'¿Cuándo lo entregan?',reply:'Se estima para 2028.',audit:{},units:[],groups:[],obligations:[],projectFacts:[],claimSources:sources,allowedLinks:[]})
  assert.deepEqual((risk.fuentes_autorizadas as Record<string,unknown>).entrega_proyecto,entrega_proyecto)
})
