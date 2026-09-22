/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { normalizeTurnSemantics, pendingQuestionFromReply } = require('../src/lib/integrations/automation/turn-semantics.ts')
const { resolvePropertyTurn, rememberPropertyReply, unitsInPropertyReply } = require('../src/lib/integrations/automation/property-context.ts')
const { unitPriceQuote } = require('../src/lib/integrations/automation/price-reply.ts')
const { continueUnitAlternative } = require('../src/lib/integrations/automation/unit-alternatives.ts')
const { preferredPropertyCategory, propertySelectionReply } = require('../src/lib/integrations/automation/property-selection.ts')
const { responsePlan } = require('../src/lib/integrations/automation/response-plan.ts')

const catalog = [
  { id:'u202',unit_number:'202',category:'departamento',floor:'Segunda planta alta',floor_number:2,bedrooms:3,area_internal_m2:120.83,published_commercial_price:250000 },
  { id:'u302',unit_number:'302',category:'departamento',floor:'Tercera planta alta',floor_number:3,bedrooms:3,area_internal_m2:120.83,published_commercial_price:270000 },
  { id:'u602',unit_number:'602',category:'penthouse',floor:'Sexta planta alta',floor_number:6,bedrooms:3,area_internal_m2:142.09,published_commercial_price:550000 },
  { id:'u605',unit_number:'605',category:'penthouse',floor:'Sexta planta alta',floor_number:6,bedrooms:3,area_internal_m2:140.53,published_commercial_price:540000 },
]
const apartments = [{role:'bot',content:'El departamento 202 está en la segunda planta y el 302 en la tercera. Ambos tienen 3 dormitorios.'}]
const penthouses = [{role:'bot',content:'Estas son las opciones: el penthouse 602 (142,09 m²); el penthouse 605 (140,53 m²). ¿Cuál de estas opciones le gustaría conocer?'}]
function semantics(current, property) {
  return normalizeTurnSemantics({turn_semantics:{primary_intent:'select_property',primary_evidence:current,confidence:'high',property:{...property,evidence:current,confidence:'high'}}},current,{})
}
function info(reference, history, overrides={}) {
  return {catalogo:catalog,referencia_unidad:reference,property_context:reference.context,historial:history,
    lead:{preferred_category:'departamento'},politica_comercial:{precios_autorizados:true,precios_aproximados:true},...overrides}
}

test('literal evidence validates property semantics and cannot silently accept foreign or contradictory categories',()=>{
  const current='Prefiero los departamentos porque los penthouses deben ser caros'
  const valid=semantics(current,{category:'departamento',excluded_categories:['penthouse'],reference_kind:'none'})
  assert.equal(valid.property.category,'departamento')
  assert.equal(preferredPropertyCategory(current,valid),'departamento')
  const invalid=normalizeTurnSemantics({turn_semantics:{property:{category:'penthouse',evidence:'quiero penthouses',confidence:'high'}}},current,{})
  assert.equal(invalid.property.category,null)
  assert.equal(invalid.property.confidence,'low')
  assert.equal(semantics(current,{category:'penthouse',excluded_categories:['penthouse']}).property.category,null)
})

test('choosing apartments clears old penthouse references without treating an objection as budget',()=>{
  const current='bueno, me interesa mas los departamentos por que los penthouse deben ser muy caros.'
  const semantic=semantics(current,{category:'departamento',excluded_categories:['penthouse'],reference_kind:'none'})
  const reference=resolvePropertyTurn(catalog,current,{_unit_reference:{ids:['u602']},_property_context:{selected_ids:['u602']}},penthouses,semantic)
  assert.equal(reference.reason,'category_change')
  assert.deepEqual(reference.matches,[])
  assert.equal(reference.context.preference_category,'departamento')
  assert.deepEqual(reference.context.selected_ids,[])
  assert.equal(semantic.budget.status,'not_discussed')
  const journey=continueUnitAlternative(info(reference,[{role:'bot',content:'¿Desea revisar primero los departamentos o los penthouses?'}],{semantica_turno:semantic}),current)
  assert.match(journey.reply,/planta/i)
  assert.doesNotMatch(journey.reply,/penthouse 602|142,09|360/)
})

test('relative largest follows the actually shown penthouse list despite old apartment preference',()=>{
  const current='me interesa mas el mas grande'
  for (const semantic of [{},semantics(current,{reference_kind:'relative',selector:'largest'})]) {
    const reference=resolvePropertyTurn(catalog,current,{_unit_reference:{ids:['u202']},_property_context:{selected_ids:['u202']}},penthouses,semantic)
    assert.equal(reference.reason,'relative_selection')
    assert.deepEqual(reference.matches.map(unit=>unit.id),['u602'])
    assert.deepEqual(reference.context.selected_ids,['u602'])
    const reply=propertySelectionReply(info(reference,penthouses,{semantica_turno:semantic}),current)
    assert.match(reply.reply,/602/)
    assert.doesNotMatch(reply.reply,/departamento 202|departamento 302/)
  }
})

test('ties and missing areas require clarification; no arbitrary UUID is selected',()=>{
  const tied=resolvePropertyTurn(catalog,'el más grande',{},apartments,{})
  assert.equal(tied.needsClarification,true)
  assert.equal(tied.explicit,false)
  assert.match(tied.clarification,/202.*302/)
  const unknown=resolvePropertyTurn(catalog.map(unit=>unit.id==='u602'?{...unit,area_internal_m2:null}:unit),'el más grande',{},penthouses,{})
  assert.equal(unknown.needsClarification,true)
  assert.equal(unknown.explicit,false)
})

test('relative order uses displayed order rather than inventory ordering',()=>{
  const history=[{role:'bot',content:'El penthouse 605 y el penthouse 602. ¿Cuál de estas opciones le gustaría conocer?'}]
  assert.deepEqual(unitsInPropertyReply(catalog,history[0].content).map(unit=>unit.id),['u605','u602'])
  assert.equal(resolvePropertyTurn(catalog,'la primera',{},history,{}).matches[0].id,'u605')
})

test('a complete comparison survives the delivered answer and quotes both verified prices in every commercial mode',()=>{
  for (const mode of ['lanzamiento','preventa']) {
    const first=resolvePropertyTurn(catalog,'y cual es la diferencia entre el 202 y el 302?',{},[],{})
    assert.deepEqual(first.matches.map(unit=>unit.id),['u202','u302'])
    const stored=rememberPropertyReply(catalog,first.context,apartments[0].content,{})
    const summary={_property_context:stored,_unit_reference:first.memory}
    for (const current of ['y en precio?','¿Y el precio?','¿Cuánto cuestan?']) {
      const followup=resolvePropertyTurn(catalog,current,summary,apartments,{})
      assert.equal(followup.reason,'comparison_followup')
      const quote=unitPriceQuote(info(followup,apartments,{modo_comercial:mode}),current,summary)
      assert.match(quote.reply,/202.*250[.,]000.*302.*270[.,]000/)
      assert.equal(quote.comparison.difference,20000)
      assert.ok(responsePlan(quote.reply,{source:'unit_price',verified_price_only:true}).locked)
    }
  }
})

test('negations and incidental comparisons cannot override an explicit category or choose a rejected unit',()=>{
  const current='prefiero departamentos, el penthouse es más grande'
  const reference=resolvePropertyTurn(catalog,current,{},penthouses,semantics(current,{category:'departamento',reference_kind:'none'}))
  assert.equal(reference.reason,'category_change')
  for(const current of ['no quiero el más grande','el departamento 202 no me interesa','no quiero el departamento 202']) {
    const result=resolvePropertyTurn(catalog,current,{},penthouses,{})
    assert.equal(result.explicit,false,current)
    assert.ok(!result.context.selected_ids?.length,current)
  }
})

test('actual new suggestions supersede an old comparison even when a writer generated them',()=>{
  const stored=rememberPropertyReply(catalog,{comparison_ids:['u202','u302'],selected_ids:['u202']},penthouses[0].content,{})
  assert.deepEqual(stored.comparison_ids,[])
  assert.deepEqual(stored.selected_ids,[])
  assert.equal(resolvePropertyTurn(catalog,'y en precio?',{_property_context:stored},penthouses,{}).needsClarification,true)
})

test('semantic explicit numbers work outside legacy patterns and residential naming follows catalog',()=>{
  for(const current of ['202 vs 302','compara las opciones 202 y 302']) {
    const result=resolvePropertyTurn(catalog,current,{},[],semantics(current,{reference_kind:'comparison',unit_numbers:['202','302']}))
    assert.deepEqual(result.matches.map(unit=>unit.id),['u202','u302'])
  }
  const current='me interesa el departamento 602'
  const result=resolvePropertyTurn(catalog,current,{},[],semantics(current,{category:'departamento',reference_kind:'explicit',unit_numbers:['602']}))
  assert.deepEqual(result.matches.map(unit=>unit.id),['u602'])
  const padded=[{id:'s1',unit_number:'001',category:'suite'},{id:'l1',unit_number:'LC-01',category:'local'}]
  for(const [current,number,id] of [['suite 1','1','s1'],['local LC-1','LC-1','l1']]) {
    const reference=resolvePropertyTurn(padded,current,{},[],semantics(current,{reference_kind:'explicit',unit_numbers:[number]}))
    assert.deepEqual(reference.matches.map(unit=>unit.id),[id])
    assert.equal(reference.needsClarification,false)
  }
})

test('unavailable comparison member is reported instead of silently quoting the remaining unit',()=>{
  const summary={_property_context:{comparison_ids:['u202','u302'],last_reply:apartments[0].content}}
  const reference=resolvePropertyTurn(catalog.filter(unit=>unit.id!=='u302'),'y en precio?',summary,apartments,{})
  assert.equal(reference.needsClarification,true)
  assert.match(reference.clarification,/ya no aparece/)
  assert.equal(resolvePropertyTurn(catalog,'compara el 202 y el 999',{},[],{}).needsClarification,true)
})

test('generic question after an offer does not silently select it, including a singleton',()=>{
  for (const history of [penthouses,[{role:'bot',content:'Tenemos el penthouse 602. ¿Cuál de estas opciones le gustaría conocer?'}]]) {
    const reference=resolvePropertyTurn(catalog,'y en precio?',{},history,{})
    assert.equal(reference.needsClarification,true)
    assert.equal(reference.explicit,false)
  }
})

test('affirmative confirms only one offered option and never selects among several',()=>{
  const history=[{role:'bot',content:'En esta planta tenemos el departamento 202. ¿Le gustaría conocer esta opción?'}]
  const reference=resolvePropertyTurn(catalog,'sí por favor',{},history,{})
  assert.equal(reference.reason,'confirmed_single_option')
  assert.deepEqual(reference.matches.map(unit=>unit.id),['u202'])
  assert.match(propertySelectionReply(info(reference,history),'sí por favor').reply,/tour\?unidad=202/)
  assert.equal(resolvePropertyTurn(catalog,'sí por favor',{},penthouses,{}).needsClarification,true)
})

test('semantic explicit selection must be grounded in this turn and available catalog',()=>{
  const current='No el departamento 202, quiero el penthouse 602'
  const reference=resolvePropertyTurn(catalog,current,{},[],semantics(current,{category:'penthouse',reference_kind:'explicit',unit_numbers:['602']}))
  assert.deepEqual(reference.matches.map(unit=>unit.id),['u602'])
  const bad=resolvePropertyTurn(catalog,'quiero la unidad 999',{},[],semantics('quiero la unidad 999',{reference_kind:'explicit',unit_numbers:['602']}))
  assert.equal(bad.needsClarification,true)
  assert.deepEqual(bad.matches,[])
})

test('switch to another subject clears active references and actual reply stores offers separately from selections',()=>{
  const selected={selected_ids:['u602'],comparison_ids:['u202','u302']}
  const memory=rememberPropertyReply(catalog,selected,'Si se refiere a las papas, no gestionamos la venta de alimentos.',{source:'business_out_of_scope'})
  assert.deepEqual(memory.selected_ids,[])
  assert.deepEqual(memory.comparison_ids,[])
  const offered=rememberPropertyReply(catalog,{},penthouses[0].content,{source:'unit_alternative_journey',alternative_phase:'choose_unit',offered_unit_ids:['u602','u605']})
  assert.deepEqual(offered.offered_ids,['u602','u605'])
  assert.equal(offered.selected_ids,undefined)
  assert.equal(offered.journey,'residential_alternatives')
  assert.equal(pendingQuestionFromReply(penthouses[0].content).id,'unit_choice')
  assert.equal(pendingQuestionFromReply('¿Desea revisar primero los departamentos o los penthouses?').id,'property_category')
})
