import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { normalizedPendingQuestion } from './turn-semantics'
import { turnBudgetAssessment } from './turn-budget'
import { reviewObligations } from './focused-review'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { interpretationInput, reconcilePassivePropertyMemory, interpretationSourceIssues } from './turn-interpretation-input'
import { aiRequestBody } from './ai-request-body'
import { aiPromptCacheKey } from './ai-prompt-cache'
import { object, type Row } from './data'

const units = [
  { id:'d302',unit_number:'302',category:'departamento',bedrooms:3,floor_number:3,published_commercial_price:270000 },
  { id:'p602',unit_number:'602',category:'penthouse',bedrooms:3,floor_number:6,published_commercial_price:550000 },
]

test('unavailable requirements preserve an approximate budget and ask for flexibility before choosing floors', () => {
  for (const amount of [90000,400000,650000]) for (const bedrooms of [4,5]) {
    let info: Row = { catalogo:units,catalog_read:{ complete:true },catalog_search:{ embeddingsEnabled:false },
      politica_comercial:{ precios_autorizados:true },lead:{ purchase_purpose:'vivir',preferred_bedrooms:bedrooms },
      recorrido_comercial:{},property_context:{ query:{ group:'residential',filters:{ bedrooms } } },
      semantica_turno:{ budget:{ status:'amount',amount,confidence:'high',evidence:`estimo ${amount}, no estoy seguro` } },
      financiamiento:{ partners:['Cooperativa JEP'],journey:{} } }
    info.presupuesto_del_turno=turnBudgetAssessment(info,{})
    assert.equal(object(info.presupuesto_del_turno).status,'no_matching_features')
    const plan=commercialJourneyPlan(info)
    assert.equal(plan.action,'clarify_requirements')
    assert.equal(plan.financing_offer_allowed,false)
    assert.equal(object(plan.readiness).budget && object(object(plan.readiness).budget).amount,amount)
    info={ ...taskVerifiedContext(info,{},''),siguiente_paso_comercial:plan }
    const evidence=turnEvidence(info)
    const model=taskModelEvidence(evidence,info)
    assert.deepEqual(model.units,[])
    assert.ok(evidence.groups.some(g => g.published_commercial_price===550000))
    assert.ok(model.groups.some(g => g.bedrooms===3))
    assert.ok(model.groups.every(g => g.published_commercial_price===undefined))
    assert.equal(evidence.units.length,2) // validation retains full canonical evidence
    const obligations=reviewObligations({},info,{})
    const budgetNext=obligations.find(o=>o.id==='budget_continuation')!
    assert.match(String(budgetNext.instruction),/requisito/)
    assert.doesNotMatch(String(budgetNext.instruction),/Presente las plantas/)
    const pending=normalizedPendingQuestion(journeyPendingQuestion('¿Consideraría una opción de tres dormitorios?',plan,true,
      { continuation_id:'property_requirements',continuation_act:'explore_alternatives',purpose:'clarify_request' }),units)
    assert.equal(pending.id,'property_requirements')
  }
})

test('disabling vector ranking still compacts extraction while preserving identity, negation, floor zero and current statements', () => {
  const input=interpretationInput({ catalog_search:{ embeddingsEnabled:false },catalogo_unidades:units,
    unidades_identificadas:[{ ...units[0],floor_number:0 }],contexto_propiedades:{ selected_ids:['d302'],query:{ filters:{ floor_number:0 } } },
    financiamiento:{ current:{ explicit_consent:false,financing_partner:'Cooperativa JEP' } } },'estimo 400 mil')
  assert.equal(input.mensaje_actual,'estimo 400 mil')
  assert.deepEqual(input.catalogo_unidades,[{ category:'departamento',unit_numbers:['302'] },{ category:'penthouse',unit_numbers:['602'] }])
  assert.equal(object((input.unidades_identificadas as Row[])[0]).floor_number,0)
  assert.equal(object(object(input.financiamiento).current).explicit_consent,false)
})

test('cache routing is stable across leads, changes with contracts, and never changes models or storage', () => {
  const options={ model:'gpt-4.1',instructions:'same instructions',schema:{ type:'object' },input:{ lead:'A' } }
  const first=aiRequestBody({ ...options,promptCacheKey:aiPromptCacheKey(options) }),second=aiRequestBody({ ...options,input:{ lead:'B' },promptCacheKey:aiPromptCacheKey(options) })
  assert.equal(first.prompt_cache_key,'lavilet:73a3c9b9ffc913ec8022275dd936dcabf650101158aacfd8','preserve the deployed cache route')
  assert.equal(first.prompt_cache_key,second.prompt_cache_key)
  assert.notEqual(first.prompt_cache_key,aiPromptCacheKey({ ...options,instructions:'changed' }))
  assert.equal(first.store,false)
  assert.equal(first.model,'gpt-4.1')
  assert.equal(JSON.parse(second.input[0].content[0].text!.split('\n')[1]).lead,'B')
})

test('unchanged passive preference needs no extraction retry, but changed preferences and new choices still do', () => {
  const input={ contexto_propiedades:{ query:{ group:'residential',category:'departamento' } } }
  const raw: Row={ turn_semantics:{ property:{ group:'residential',category:null,operation:'none',reference_kind:'none',filters:{bedrooms:null},unit_numbers:[],evidence:'',confidence:'high' } } }
  assert.deepEqual(interpretationSourceIssues(reconcilePassivePropertyMemory(raw,input),'estimo 400 mil'),[])
  assert.equal(object(object(input.contexto_propiedades).query).group,'residential')
  for(const change of [{group:'commercial'},{operation:'select'},{filters:{bedrooms:2}},{unit_numbers:['302']}]) {
    const changed={ ...raw,turn_semantics:{property:{...object(object(raw.turn_semantics).property),...change}} }
    assert.deepEqual(reconcilePassivePropertyMemory(changed,input),changed)
    assert.ok(interpretationSourceIssues(changed,'estimo 400 mil').includes('missing_current_evidence:property'))
  }
})
