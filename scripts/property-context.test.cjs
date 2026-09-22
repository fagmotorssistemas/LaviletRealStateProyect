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
const { catalogDialogueReply } = require('../src/lib/integrations/automation/catalog-dialogue.ts')

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

test('accepting an alternative query advances from five to exploring three without changing the original need', () => {
  const available = [...catalog, { id: 'u304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3, area_internal_m2: 109.69 }]
  const first = resolvePropertyTurn(available, 'Busco vivienda de cinco cuartos', {}, [], semantics('Busco vivienda de cinco cuartos', { operation: 'search' }))
  const offer = 'No tenemos cinco dormitorios. ¿Le gustaría revisar las alternativas de tres dormitorios?'
  const pending = { id: 'property_category', act: 'explore_alternatives', question: '¿Le gustaría revisar las alternativas de tres dormitorios?',
    candidate_ids: catalog.map(unit => unit.id), target_ids: [], proposed_query: { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } } }
  const stored = rememberPropertyReply(available, first.context, offer, { catalog_query: first.query, original_query: first.query, pending_question: pending })
  assert.equal(stored.query.filters.bedrooms, 5)
  assert.equal(stored.original_query.filters.bedrooms, 5)
  for (const operation of ['none', 'search', 'select']) {
    const current = 'si esta bien'
    const semantic = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
      property: { operation, reference_kind: 'followup', evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: 'property_category', kind: 'affirmative', evidence: current, confidence: 'high' } } }, current, stored.pending_question)
    const accepted = resolvePropertyTurn(available, current, { _property_context: stored }, [{ role: 'bot', content: offer }], semantic)
    assert.equal(accepted.reason, 'accepted_alternative_query', operation)
    assert.equal(accepted.query.operation, 'search', operation)
    assert.equal(accepted.query.filters.bedrooms, 3, operation)
    assert.equal(accepted.context.original_query.filters.bedrooms, 5, operation)
    assert.equal(accepted.explicit, false, operation)
    assert.deepEqual(accepted.context.selected_ids, [], operation)
    assert.ok(accepted.matches.every(unit => unit.bedrooms === 3), operation)
    const answer = catalogDialogueReply({ ...info(accepted, []), catalogo: available, semantica_turno: semantic }, current)
    assert.doesNotMatch(answer.reply, /no contamos.*5 dormitorios/i)
    const memory = rememberPropertyReply(available, accepted.context, answer.reply, answer.audit)
    const choice = 'Me interesan los departamentos porque los penthouses son caros'
    const chosenCategory = resolvePropertyTurn(available, choice, { _property_context: memory }, [{ role: 'bot', content: answer.reply }],
      semantics(choice, { category: 'departamento', excluded_categories: ['penthouse'], operation: 'select' }))
    const apartments = catalogDialogueReply({ ...info(chosenCategory, []), catalogo: available }, choice)
    assert.equal(chosenCategory.query.filters.bedrooms, 3, operation)
    assert.equal(chosenCategory.context.original_query.filters.bedrooms, 5, operation)
    assert.ok(apartments.audit.catalog_results.units.every(unit => unit.category === 'departamento' && unit.bedrooms === 3), operation)
    assert.doesNotMatch(apartments.reply, /304|2 dormitorios/)
    assert.deepEqual(chosenCategory.context.selected_ids, [], operation)
  }
})

test('an affirmative to an ambiguous set never picks its first unit or invents a relaxed query', () => {
  const pending = { id: 'unit_choice', act: 'choose_unit', question: '¿Cuál le interesa?', candidate_ids: ['u202', 'u302'], target_ids: [] }
  const previous = { _property_context: { last_reply: pending.question, pending_question: pending, offered_ids: ['u202', 'u302'], selected_ids: [] } }
  const reference = resolvePropertyTurn(catalog, 'sí está bien', previous, [{ role: 'bot', content: pending.question }], {})
  assert.equal(reference.needsClarification, true)
  assert.equal(reference.reason, 'question_requires_choice')
  assert.equal(reference.explicit, false)
  assert.deepEqual(reference.context.selected_ids, [])
  const malformed = { ...pending, id: 'property_category', act: 'explore_alternatives' }
  const noProposal = resolvePropertyTurn(catalog, 'sí está bien', { _property_context: { ...previous._property_context, pending_question: malformed } }, [], {})
  assert.notEqual(noProposal.reason, 'accepted_alternative_query')
  assert.deepEqual(noProposal.context.selected_ids, [])
  const categoryChoice = { id: 'property_category', act: 'choose_category', question: '¿Departamentos o penthouses?', candidate_ids: ['u202', 'u602'] }
  const context = { last_reply: categoryChoice.question, pending_question: categoryChoice, query: { group: 'residential', category: null, filters: { bedrooms: 3 } } }
  const ambiguous = resolvePropertyTurn(catalog, 'sí está bien', { _property_context: context }, [],
    semantics('sí está bien', { category: 'departamento', operation: 'select' }))
  assert.equal(ambiguous.query.category, null)
  assert.equal(ambiguous.query.operation, 'search')
  assert.deepEqual(ambiguous.context.selected_ids, [])
})

test('residential category refinements retain constraints and a change to commercial use clears them', () => {
  const previous = { _property_context: { query: { group: 'residential', category: null, filters: { bedrooms: 3, floor_number: 3, min_area_m2: 100 } },
    original_query: { group: 'residential', filters: { bedrooms: 5 } } } }
  const current = 'Prefiero departamentos'
  const apartment = resolvePropertyTurn(catalog, current, previous, [], semantics(current, { category: 'departamento', operation: 'select' }))
  assert.equal(apartment.query.filters.bedrooms, 3)
  assert.equal(apartment.query.filters.floor_number, 3)
  assert.equal(apartment.query.filters.min_area_m2, 100)
  const commercial = resolvePropertyTurn(catalog, 'Busco un local', previous, [], semantics('Busco un local', { category: 'local', operation: 'search' }))
  assert.equal(commercial.query.filters.bedrooms, null)
  assert.equal(commercial.query.filters.floor_number, null)
  assert.deepEqual(commercial.context.original_query, {})
})

test('the exact legacy no-match offer can be accepted using its verified alternative IDs', () => {
  const question = '¿Le gustaría revisar las alternativas disponibles?'
  const previous = { _pending_question: { id: 'property_category', act: 'choose_category', question, candidate_ids: ['u202', 'u302', 'u602'] },
    _property_context: { query: { group: 'residential', category: null, filters: { bedrooms: 5 }, operation: 'search' } } }
  const accepted = resolvePropertyTurn(catalog, 'si esta bien', previous, [], semantics('si esta bien', { operation: 'search' }))
  assert.equal(accepted.reason, 'accepted_alternative_query')
  assert.equal(accepted.query.filters.bedrooms, 3)
  assert.equal(accepted.context.original_query.filters.bedrooms, 5)
  assert.deepEqual(accepted.context.selected_ids, [])
  for (const pending of [
    { ...previous._pending_question, question: '¿Departamentos o penthouses?' },
    { ...previous._pending_question, candidate_ids: ['u202', 'retired'] },
    { ...previous._pending_question, candidate_ids: [] },
  ]) {
    const result = resolvePropertyTurn(catalog, 'si esta bien', { ...previous, _pending_question: pending }, [], {})
    assert.notEqual(result.reason, 'accepted_alternative_query')
    assert.equal(result.query.filters.bedrooms, 5)
  }
  const refused = resolvePropertyTurn(catalog, 'No, necesito cinco dormitorios', previous, [], semantics('No, necesito cinco dormitorios', { operation: 'search' }))
  assert.notEqual(refused.reason, 'accepted_alternative_query')
  assert.equal(refused.query.filters.bedrooms, 5)
})

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

test('catalog ranking without numbered offers returns verified maxima without selecting', () => {
  const current = 'cual es la opcion mas grande?'
  const semantic = semantics(current, { operation: 'rank', reference_kind: 'relative', selector: 'largest', query_scope: 'catalog' })
  const reference = resolvePropertyTurn(catalog, current, {}, [{ role: 'bot', content: 'Tenemos opciones en varias plantas.' }], semantic)
  assert.equal(reference.reason, 'catalog_rank')
  assert.equal(reference.needsClarification, false)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u602'])
  assert.deepEqual(reference.context.selected_ids, [])
  assert.equal(reference.explicit, false)
})

test('ties answer a ranking query while an ambiguous selection still needs a choice', () => {
  const current = 'cual es el departamento mas grande?'
  const reference = resolvePropertyTurn(catalog, current, {}, [], semantics(current, { category: 'departamento', operation: 'rank', reference_kind: 'relative', selector: 'largest' }))
  assert.equal(reference.reason, 'ranking_tie')
  assert.equal(reference.needsClarification, false)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u202', 'u302'])
  assert.deepEqual(reference.context.selected_ids, [])
  assert.equal(resolvePropertyTurn(catalog, 'prefiero el mas grande', {}, apartments, {}).needsClarification, true)
})

test('normalized floor search outranks an incorrectly inferred historical unit number', () => {
  const current = 'entiendo quiero la opcion de la 5ta planta'
  const fifth = [...catalog, { ...catalog[0], id: 'u502', unit_number: '502', floor_number: 5 }]
  const reference = resolvePropertyTurn(fifth, current, {}, [], semantics(current, { category: 'departamento', reference_kind: 'explicit', unit_numbers: ['502'] }))
  assert.equal(reference.needsClarification, false)
  assert.equal(reference.reason, 'catalog_search')
  assert.equal(reference.query.filters.floor_number, 5)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u502'])
  assert.deepEqual(reference.context.selected_ids, [])
})

test('an affirmative follows the structured focus even after two alternatives were shown', () => {
  const fifth = [{ ...catalog[0], id: 'u502', unit_number: '502', floor_number: 5 }, { ...catalog[0], id: 'u504', unit_number: '504', floor_number: 5, area_internal_m2: 87 }]
  const reply = 'Dos alternativas, con una recomendación concreta. ¿Desea más detalles?'
  const pending = { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea más detalles?', target_ids: ['u502'], candidate_ids: ['u502', 'u504'] }
  const stored = rememberPropertyReply(fifth, {}, reply, { offered_unit_ids: ['u502', 'u504'], focused_unit_ids: ['u502'], pending_question: pending })
  assert.equal(stored.version, 2)
  assert.deepEqual(stored.offered_ids, ['u502', 'u504'])
  assert.deepEqual(stored.focused_ids, ['u502'])
  const current = 'si prefiero esa opcion'
  for (const property of [{ reference_kind: 'explicit', unit_numbers: ['502'], category: 'departamento' }, { reference_kind: 'followup', unit_numbers: ['502'] }, {}]) {
    const reference = resolvePropertyTurn(fifth, current, { _property_context: stored }, [{ role: 'bot', content: reply }], semantics(current, property))
    assert.equal(reference.reason, 'confirmed_question_target')
    assert.equal(reference.needsClarification, false)
    assert.deepEqual(reference.matches.map(unit => unit.id), ['u502'])
    assert.deepEqual(reference.context.selected_ids, ['u502'])
  }
})

test('new structured metadata is authoritative over paraphrased output and stale rankings are not replayed', () => {
  const reply = 'Podemos empezar por la opción que acabamos de revisar.'
  const stored = rememberPropertyReply(catalog, { query: { operation: 'rank', selector: 'largest', category: 'departamento', filters: { bedrooms: 3 } } }, reply,
    { offered_unit_ids: ['u202'], focused_unit_ids: ['u202'], pending_question: { id: 'unit_choice', act: 'confirm_unit', question: '', target_ids: ['u202'], candidate_ids: ['u202'] } })
  const result = resolvePropertyTurn(catalog, 'gracias', { _property_context: stored }, [{ role: 'bot', content: reply }], {})
  assert.equal(result.query.operation, 'none')
  assert.equal(result.query.selector, null)
  assert.equal(result.query.filters.bedrooms, 3)
  assert.deepEqual(result.context.focused_ids, ['u202'])
  assert.deepEqual(result.context.selected_ids, [])
})

test('a retired focused option is never replaced by another available candidate', () => {
  const pending = { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea verla?', target_ids: ['u502'], candidate_ids: ['u502', 'u504'] }
  const summary = { _property_context: { version: 2, last_reply: '¿Desea verla?', offered_ids: ['u502', 'u504'], focused_ids: ['u502'], pending_question: pending } }
  const result = resolvePropertyTurn([{ id: 'u504', category: 'departamento', unit_number: '504' }], 'si prefiero esa opcion', summary, [{ role: 'bot', content: '¿Desea verla?' }], {})
  assert.equal(result.reason, 'question_target_unavailable')
  assert.equal(result.needsClarification, true)
  assert.deepEqual(result.matches, [])
})

test('a selected target uses catalogue category rather than filters from an older search', () => {
  const current = 'me interesa mas el mas grande'
  const reference = resolvePropertyTurn(catalog, current, { _property_context: {
    preference_category: 'departamento', query: { category: 'departamento', group: 'residential', filters: { floor_number: 2, bedrooms: 2 } },
  } }, penthouses, semantics(current, { reference_kind: 'relative', selector: 'largest', operation: 'select' }))
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u602'])
  assert.equal(reference.query.category, 'penthouse')
  assert.equal(reference.query.filters.floor_number, null)
  assert.equal(reference.query.filters.bedrooms, null)
})

test('an explicit comparison replaces an older search category without becoming a selection', () => {
  const current = 'compara el 202 y el 302'
  const reference = resolvePropertyTurn(catalog, current, { _property_context: {
    preference_category: 'penthouse', query: { category: 'penthouse', filters: { floor_number: 6 } },
  } }, [], semantics(current, { operation: 'compare', reference_kind: 'comparison', unit_numbers: ['202', '302'] }))
  assert.equal(reference.query.category, 'departamento')
  assert.equal(reference.query.filters.floor_number, null)
  assert.equal(reference.query.scope, 'comparison')
  assert.deepEqual(reference.context.selected_ids, [])
  assert.deepEqual(reference.context.comparison_ids, ['u202', 'u302'])
})
