import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationGroups, explainStep, humanValue, stepTitle } from './messageExplanation'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { promptContextParts } from './promptContext'
import { reviewDecision } from './reviewDecision'

test('comparison audit separates inherited characteristics from current constraints and shows resolved referents', () => {
  const item = step(1, 'response_coverage', { status: 'checked',
    catalog_results: { units: [{ id: 'unit-a', unit_number: '801', category: 'departamento' }, { id: 'unit-b', unit_number: '803', category: 'departamento' }] },
    filter_resolution: { current: { floor_number: null }, inherited: { floor_number: 6 }, evidence: {} },
    reference_resolution: { source: 'pending_question', requested_ids: ['unit-a', 'unit-b'], resolved_ids: ['unit-a', 'unit-b'], status: 'resolved' } })
  const body = JSON.stringify(explainStep(execution([item]), item).coverageSections)
  assert.match(body, /Restricciones del mensaje actual/)
  assert.match(body, /Características heredadas, sin nueva restricción/)
  assert.match(body, /Unidades de la consulta actual/)
  assert.match(body, /departamento 801/)
  assert.match(body, /departamento 803/)
})

test('route and fallback reasons explain decisions without misreading historical question counts',()=>{
  assert.match(humanValue('current_request_overrides_pending_visit'),/consulta actual no pide una visita/)
  assert.match(reviewDecision({status:'rejected_guard',issues:['question_count']}).causes.join(' '),/una sola pregunta/)
  const item=step(1,'response_coverage',{status:'rejected_guard',fallback_validation:{passed:false,issues:['fallback_unanswered_request'],unanswered_requests:['¿Qué unidades tienen?']}})
  assert.match(JSON.stringify(explainStep(execution([item]),item).coverageSections),/Validación de la respuesta de respaldo/)
  assert.match(JSON.stringify(explainStep(execution([item]),item).coverageSections),/Qué unidades tienen/)
})

test('quantity evidence and final integrity explain acceptance versus unresolved references',()=>{
  const item=step(1,'response_coverage',{status:'checked',final_validation:{project_quantity_checks:[{fragment:'24 horas',context:'seguridad',outcome:'supported',evidence:[{subject:'Seguridad',text:'24h',source:'instalaciones.0'}]}]}})
  const sections=explainStep(execution([item]),item).coverageSections!
  assert.match(JSON.stringify(sections),/Respaldada/)
  assert.match(JSON.stringify(sections),/instalaciones.0/)
  const invalid=reviewDecision({status:'rejected_guard',issues:['quantity_reference_unresolved'],final_validation:{project_quantity_checks:[{fragment:'24 horas',context:'piscina',outcome:'unresolved'}]}})
  assert.match(invalid.details.join(' '),/no significa que el dato sea falso/)
})

test('coverage shows subsequent handoff changes without presenting its intermediate reply as delivered',()=>{
  const coverage=step(1,'response_coverage',{status:'checked',needs_advisor:false,handoff_assessments:[{fragment:'precio?',outcome:'clarification_needed',reason:'Falta identificar la unidad'}]})
  const validation=step(2,'response_validation',{text_transformations:[{stage:'Derivación',before:'¿Qué unidad?',after:'Aviso. ¿Qué unidad?'}]})
  const sections=explainStep(execution([coverage,validation]),coverage).coverageSections!
  assert.ok(sections.some(section=>section.title==='Cambios posteriores a esta aprobación'))
  assert.match(JSON.stringify(sections),/precisión del cliente/)
  assert.match(JSON.stringify(sections),/Aviso/)
})

test('text changes distinguish the reviewed draft from the final formatting before delivery',()=>{
  for(const key of ['response_coverage','response_validation']){
    const item=step(1,key,{status:'checked',text_transformations:[{stage:'Normalización de ruta',before:'Texto original',after:'Texto modificado'}]})
    const section=explainStep(execution([item]),item).coverageSections!.find(s=>s.title==='Cambios del sistema sobre el texto')!
    assert.equal(section.facts[1].value,'Texto original')
    assert.equal(section.facts[2].value,'Texto modificado')
    assert.match(section.description,/versión resultante/)
  }
})

test('commercial continuation explains the recorded objective selection question and reviewer verdict', () => {
  const item=step(1,'response_coverage',{status:'checked',commercial_continuation:{objective:'Resolver la limitación económica',current_request:'Presupuesto limitado',selected_units:['penthouse 805'],question:{text:'¿Alternativas o financiamiento?',missing_datum:'Preferencia',next_decision:'Elegir camino'},checks:{operational_goal_preserved:true}}})
  const sections=explainStep(execution([item]),item).coverageSections!
  const section=sections.find(section=>section.title==='Objetivo y continuación comercial')!
  assert.ok(section)
  assert.equal(section.facts.find(f=>f.label==='Selección de referencia')?.value,'penthouse 805')
  assert.equal(section.facts.find(f=>f.label==='Propósito de la pregunta')?.value,'Elegir camino')
  assert.match(section.facts.find(f=>f.label==='Resultado y motivo')!.value,/aceptada/)
  const old=explainStep(execution([step(2,'response_coverage')]),step(2,'response_coverage')).coverageSections!
  assert.equal(old.some(section=>section.title==='Objetivo y continuación comercial'),false)
})

test('progressive selection explains the quoted filter and next decision without treating offered units as chosen', () => {
  const catalogue = step(1, 'catalog_resolution', { catalog_snapshot: [
    { id: 'p602', unit_number: '602', category: 'penthouse' }, { id: 'p605', unit_number: '605', category: 'penthouse' },
  ] })
  const review = step(2, 'response_coverage', { status: 'checked', progressive_selection: {
    stage: 'offer_details', question: '¿Le gustaría obtener más detalles de alguna de estas opciones?',
    candidate_ids: ['p602', 'p605'], criteria: { category: 'penthouse', bedrooms: 3 }, reason: 'explain_current_quoted_options',
  } })
  const section = explainStep(execution([catalogue, review]), review).coverageSections!.find(s => s.title === 'Opciones de interés y siguiente paso')!
  assert.match(section.description, /no equivale a elegir una unidad/)
  assert.match(section.facts.find(f => f.label === 'Paso previsto')!.value, /opciones cotizadas/)
  assert.equal(section.facts.find(f => f.label === 'Opciones de referencia')!.value, 'penthouse 602, penthouse 605')
  assert.match(section.facts.find(f => f.label === 'Criterios utilizados')!.value, /Dormitorios: 3/)
  assert.match(section.facts.find(f => f.label === 'Motivo del siguiente paso')!.value, /cumplen el interés actual/)
  assert.match(section.facts.find(f => f.label === '¿El cliente pidió cambiar la búsqueda?')!.value, /No quedó registrado/)
})

test('requested preference changes and completed comparisons explain different next steps', () => {
  for (const [stage, reason, expected] of [
    ['choose_unit', 'comparison_answered_before_selection', /cliente elija una unidad/],
    ['choose_category', 'requested_fewer_bedrooms', /reducir la cantidad de dormitorios/],
    ['confirm_bedrooms', 'cheaper_requires_bedrooms_confirmation', /mantiene los dormitorios/],
  ]) {
    const item = step(1, 'response_coverage', { status: 'checked', progressive_selection: {
      stage, reason, criteria: { bedrooms_any: [1, 2] }, candidate_ids: [], question: 'Pregunta registrada',
      ...(stage === 'choose_category' ? { client_requested_change: true, preference_kind: 'fewer_bedrooms' } : {}),
    } })
    const section = explainStep(execution([item]), item).coverageSections!.find(s => s.title === 'Opciones de interés y siguiente paso')!
    assert.match(section.facts.find(f => f.label === 'Motivo del siguiente paso')!.value, expected)
    assert.equal(section.facts.find(f => f.label === 'Pregunta siguiente preparada')!.value, 'Pregunta registrada')
    if (stage === 'choose_category') {
      assert.equal(section.facts.find(f => f.label === '¿El cliente pidió cambiar la búsqueda?')!.value, 'Sí')
      assert.equal(section.facts.find(f => f.label === 'Cambio solicitado')!.value, 'Buscar menos dormitorios')
    }
  }
})

test('post-tour continuation distinguishes missing budget, ambiguous amount and a declared entry without asserting delivery', () => {
  for (const [status, amount, reason, expected] of [
    ['not_discussed', null, 'budget_missing', /todavía no consultado/],
    ['amount', 70000, 'budget_kind_missing', /distinguir total o entrada/],
    ['initial_capital', 70000, 'financing_information_available', /disponible para la entrada/],
    ['declines_to_disclose', null, 'budget_declined', /prefirió no indicar/],
  ] as const) {
    const item = step(1, 'response_coverage', { status: 'checked', post_tour_continuation: {
      question: 'Pregunta según el presupuesto', reason, budget: { status, amount, source: 'history' },
    } })
    const section = explainStep(execution([item]), item).coverageSections!.find(s => s.title === 'Continuación después del recorrido 360')!
    assert.match(section.description, /no confirma el envío del recorrido/)
    assert.match(section.facts.find(f => f.label === 'Estado del presupuesto')!.value, expected)
    assert.equal(section.facts.find(f => f.label === 'Origen del dato de presupuesto')!.value, 'Declaración del cliente en el historial')
    assert.equal(section.facts.some(f => f.label === 'Monto de referencia'), amount !== null)
  }
})

test('continuation explanations never borrow future plans or infer a budget kind from an amount', () => {
  const future = step(3, 'response_coverage', { progressive_selection: { stage: 'offer_details' }, post_tour_continuation: { budget: { status: 'maximum_total', amount: 70000 } } })
  for (const recorded of [undefined, {}]) {
    const old = step(1, 'response_coverage', { status: 'checked', progressive_selection: recorded, post_tour_continuation: recorded })
    const sections = explainStep(execution([old, future]), old).coverageSections!
    assert.equal(sections.some(s => s.title === 'Opciones de interés y siguiente paso' || s.title === 'Continuación después del recorrido 360'), false)
  }
  const incomplete = step(2, 'response_coverage', { post_tour_continuation: { budget: { amount: 70000 } } })
  const section = explainStep(execution([incomplete]), incomplete).coverageSections!.find(s => s.title === 'Continuación después del recorrido 360')!
  assert.match(section.facts.find(f => f.label === 'Estado del presupuesto')!.value, /no se deduce del monto/)
  for (const code of ['commercial_next_question_missing', 'commercial_next_question_changed']) {
    assert.doesNotMatch(humanValue(code), /commercial_next/)
    for (const output of [{ status: 'rejected_guard', issues: [code] }, { status: 'rejected_review', semantic_review: { validation_details: [{ code }] } }]) {
      const banner = reviewDecision(output)
      assert.equal(banner.tone, 'rejected')
      assert.match(banner.causes.join(' '), /pregunta/)
      assert.doesNotMatch(banner.causes.join(' '), /commercial_next/)
    }
  }
})

test('profile resolution distinguishes a declared place from unconfirmed residence and exposes only profile evidence', () => {
  const item = step(2, 'lead_profile_resolution', { profile: {
    full_name: 'Carlos', residence_city: null, residence_country: null, residence_status: 'pending_confirmation',
    declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'soy de Cuenca' },
    residence_candidate: { city: 'Cuenca', country: null, evidence: 'soy de Cuenca' },
    sources: { full_name: { evidence: 'Carlos', internal_payload: 'PRIVATE-SOURCE' }, unrelated: 'PRIVATE-EXTRA' },
    private_payload: 'PRIVATE-PAYLOAD',
  }, candidate: { city: 'Cuenca', evidence: 'soy de Cuenca' }, question_purpose: 'confirm_residence', question: '¿Es también su lugar de residencia actual?' })
  const result = explainStep(execution([item]), item)
  assert.equal(result.title, 'Nombre y residencia interpretados')
  assert.equal(result.found.find(f => f.label === 'Lugar declarado')?.value, 'Cuenca')
  assert.equal(result.found.find(f => f.label === 'Residencia actual registrada')?.value, 'No registrada.')
  assert.equal(result.found.find(f => f.label === 'Estado de residencia')?.value, 'Residencia pendiente de confirmación')
  assert.equal(result.found.find(f => f.label === 'Evidencia que motiva la confirmación')?.value, 'soy de Cuenca')
  assert.match(result.found.find(f => f.label === 'Propósito de la pregunta de perfil')!.value, /Confirmar si el lugar declarado/)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-/)
})

test('a confirmed residence stays distinct from origin and displays the recorded residence evidence', () => {
  const item = step(2, 'lead_profile_resolution', { profile: { full_name: 'Carlos', residence_status: 'confirmed',
    declared_location: { city: 'Cuenca', kind: 'origin', evidence: 'soy de Cuenca' },
    residence_city: 'Guayaquil', residence_country: null, residence_candidate: null,
    sources: { residence_city: { evidence: 'vivo en Guayaquil' } },
  } })
  const result = explainStep(execution([item]), item)
  assert.equal(result.found.find(f => f.label === 'Lugar declarado')?.value, 'Cuenca')
  assert.equal(result.found.find(f => f.label === 'Residencia actual registrada')?.value, 'Guayaquil')
  assert.equal(result.found.find(f => f.label === 'Evidencia de ciudad de residencia')?.value, 'vivo en Guayaquil')
  assert.equal(result.found.some(f => f.label === 'Lugar que necesita confirmación'), false)
})

test('introduction and review explain the profile question and first name acknowledgement from their own snapshots', () => {
  const profile_introduction = { profile_state: { full_name: 'Carlos', residence_status: 'pending_confirmation', residence_candidate: { city: 'Cuenca', evidence: 'soy de Cuenca' } },
    candidate: { city: 'Cuenca', evidence: 'soy de Cuenca' }, question_purpose: 'confirm_residence',
    question: 'Entiendo que es de Cuenca. ¿Es también su lugar de residencia actual?', name_acknowledgement: 'Mucho gusto, Carlos.' }
  const introduction = step(3, 'lead_introduction', { profile_introduction })
  const review = step(4, 'response_coverage', { status: 'checked', profile_introduction })
  for (const item of [introduction, review]) {
    const result = explainStep(execution([introduction, review]), item)
    const facts = item.key === 'lead_introduction' ? result.found : result.coverageSections!.find(s => s.title === 'Datos de perfil y confirmación')!.facts
    assert.equal(facts.find(f => f.label === 'Presentación con el nombre recibido')?.value, 'Mucho gusto, Carlos.')
    assert.equal(facts.find(f => f.label === 'Pregunta de perfil preparada')?.value, profile_introduction.question)
    assert.equal(facts.find(f => f.label === 'Lugar que necesita confirmación')?.value, 'Cuenca')
  }
  const limited = step(5, 'lead_introduction', { profile_introduction: { ...profile_introduction, candidate: '[resumen limitado]' } })
  assert.equal(explainStep(execution([limited]), limited).found.find(f => f.label === 'Lugar que necesita confirmación')?.value, 'Cuenca')
})

test('historical reviews never borrow profile state from another step or infer confirmation from a city', () => {
  const newer = step(3, 'lead_profile_resolution', { profile: { residence_city: 'Cuenca', residence_status: 'confirmed' } })
  for (const profile_introduction of [undefined, {}, { stage: 'initial' }]) {
    const old = step(1, 'response_coverage', { status: 'checked', profile_introduction })
    assert.equal(explainStep(execution([old, newer]), old).coverageSections!.some(s => s.title === 'Datos de perfil y confirmación'), false)
  }
  const partial = step(2, 'lead_profile_resolution', { profile: { residence_city: 'Cuenca' } })
  assert.match(explainStep(execution([partial]), partial).found.find(f => f.label === 'Estado de residencia')!.value, /No se registró el estado/)
})

test('profile guard reasons explain which purpose or confirmation was lost', () => {
  assert.match(humanValue('lead_profile_confirmation_omitted'), /omitió confirmar/)
  assert.match(humanValue('lead_profile_question_purpose_changed'), /dato que debía recoger o confirmar/)
  assert.match(humanValue('lead_profile_unconfirmed_residence'), /aún necesita confirmación/)
  assert.match(humanValue('lead_profile_name_acknowledgement_missing'), /Mucho gusto.*primera vez/)
  for (const code of ['lead_profile_confirmation_omitted', 'lead_profile_question_purpose_changed', 'lead_profile_unconfirmed_residence', 'lead_profile_name_acknowledgement_missing']) {
    const banner = reviewDecision({ status: 'rejected_guard', issues: [code] })
    assert.equal(banner.tone, 'rejected')
    assert.match(banner.causes[0], new RegExp(humanValue(code)))
    assert.doesNotMatch(banner.causes[0], /lead_profile_/)
    assert.doesNotMatch(reviewDecision({ status: 'rejected_review', semantic_review: { validation_details: [{ code }] } }).causes[0], /lead_profile_/)
  }
})

test('shared turn intent explains the actual objective reference evidence and scope reconciliation', () => {
  const contract = { version: 'turn-intent-v1', objective: 'ask_price', required_facts: ['price'],
    interpretation_source: 'current_turn', continuation_goal: 'ask_price', subject: { category: null, unit_numbers: [], filters: {} },
    needs_reference: true, scope: { kind: 'property', reason: 'outside_subject_not_grounded', outside_evidence: null },
    pending_question: null, profile_pending: true }
  const item = step(3, 'turn_intent', contract)
  const result = explainStep(execution([item]), item)
  assert.equal(result.title, 'Objetivo compartido del turno')
  assert.match(result.summary, /Consulta de precio/)
  assert.match(result.reason, /no tenía evidencia de otro negocio/)
  assert.equal(result.found.find(f => f.label === 'Falta precisar categoría o unidad')?.value, 'Sí')
  assert.match(result.found.find(f => f.label === 'Datos que debe responder')!.value, /Precio respaldado/)
  assert.equal(result.found.find(f => f.label === 'Categoría de referencia')?.value, 'No se registró una categoría.')
  assert.equal(result.found.find(f => f.label === 'Captura inicial de nombre y residencia pendiente')?.value, 'Sí')
  const review = step(5, 'response_coverage', { status: 'checked', resolved_turn_intent: contract })
  const section = explainStep(execution([item, review]), review).coverageSections!.find(s => s.title === result.title)!
  assert.deepEqual(section.facts, result.found.filter(f => section.facts.some(recorded => recorded.label === f.label)))
  assert.match(section.description, /no autoriza por sí sola una cita/)
})

test('a category clarification shows the retained price objective without claiming a chosen unit', () => {
  const item = step(2, 'turn_intent', { version: 'turn-intent-v1', objective: 'ask_price', required_facts: ['price'],
    interpretation_source: 'clarification_of_price_request', continuation_goal: 'ask_price',
    subject: { category: 'suite', unit_numbers: ['001', '202'], filters: { bedrooms: 1 } },
    scope: { kind: 'property' }, needs_reference: false, profile_pending: false,
    pending_question: { question: '¿En qué ciudad reside?' } })
  const result = explainStep(execution([item]), item)
  assert.match(result.found.find(f => f.label === 'Origen del objetivo')!.value, /consulta de precio anterior/)
  assert.equal(result.found.find(f => f.label === 'Unidades de referencia')?.value, '001, 202')
  assert.match(result.found.find(f => f.label === 'Filtros conservados')!.value, /Dormitorios: 1/)
  assert.equal(result.found.find(f => f.label === 'Pregunta pendiente registrada')?.value, '¿En qué ciudad reside?')
  assert.equal(result.found.some(f => f.label === 'Motivo de conciliación'), false)
  assert.match(humanValue('turn_price_unanswered'), /omitió el precio solicitado/)
})

test('unrelated scope evidence remains explicit and old reviews receive no inferred turn contract', () => {
  const current = step(2, 'turn_intent', { version: 'turn-intent-v1', objective: 'out_of_scope',
    scope: { kind: 'out_of_scope', outside_evidence: { fragment: 'reparar mi bicicleta', source: 'history' } } })
  const result = explainStep(execution([current]), current)
  assert.equal(result.found.find(f => f.label === 'Asunto ajeno citado')?.value, 'reparar mi bicicleta')
  assert.equal(result.found.find(f => f.label === 'Origen de la evidencia')?.value, 'Mensaje anterior del lead')
  for (const recorded of [undefined, {}, { objective: 'ask_price' }]) {
    const old = step(1, 'response_coverage', { status: 'checked', resolved_turn_intent: recorded })
    assert.equal(explainStep(execution([old, current]), old).coverageSections!.some(s => s.title === 'Objetivo compartido del turno'), false)
  }
})

test('review diagnostics group repeated causes while retaining individual received and expected values', () => {
  const detail={code:'catalog_value_mismatch',unit_id:'p',field:'bedrooms',received:5,expected:3}
  const decision=reviewDecision({status:'rejected_review',semantic_review:{validation_details:[detail,detail,detail]}})
  assert.equal(decision.causes.length,1)
  assert.match(decision.causes[0],/3 comprobaciones/)
  assert.equal(decision.details.length,3)
  assert.match(decision.details[0],/recibido: 5; catálogo: 3/)
  const accepted=reviewDecision({status:'checked',semantic_review:{reference_corrections:[{code:'unit_number_resolved'}]}})
  assert.match(accepted.causes[0],/sin cambiar el texto comercial/)
})

test('review decision explains the historical family draft ID failure with its actual snapshot', () => {
  const result = reviewDecision({ status: 'rejected_review', issues: ['invalid_review_metadata'], repair_attempts: [],
    semantic_review: { validation_details: [{ code: 'invalid_unit_fact', kind: 'review_metadata', unit_id: '603', field: 'bedrooms', received: 2, index: 9, fragment: 'penthouses con 2 o 3 dormitorios' }] } },
    [{ id: 'uuid-603', unit_number: '603' }])
  assert.equal(result.tone, 'metadata')
  assert.match(result.details[0], /unit_id="603"/)
  assert.match(result.details[0], /uuid-603/)
  assert.match(result.details[0], /factual_values\[9\]/)
  assert.match(result.repair, /registro histórico/)
})
test('review decision distinguishes catalogue disagreement, acceptance and missing evidence', () => {
  assert.equal(reviewDecision({ status: 'checked' }).tone, 'accepted')
  assert.equal(reviewDecision({}).tone, 'unknown')
  const mismatch = reviewDecision({ status: 'rejected_review', semantic_review: { validation_details: [{ code: 'catalog_value_mismatch', field: 'bedrooms', received: 5, expected: 3, unit_id: 'u' }] } })
  assert.equal(mismatch.tone, 'rejected')
  assert.match(mismatch.details[0], /recibido: 5; catálogo: 3/)
  const absent = reviewDecision({ status: 'rejected_review', issues: ['invalid_review_metadata'], semantic_review: { validation_details: [{ code: 'invalid_unit_fact', unit_id: '603' }] } })
  assert.match(absent.details[0], /no distingue/)
  assert.doesNotMatch(absent.details[0], /se esperaba su identificador/)
})

test('prompt colors preserve the captured JSON and identify nested conversational context only', () => {
  const data = { mensaje_actual: 'Y los precios?', contexto_verificado: {
    historial: [{ role: 'bot', content: 'Departamentos y penthouses. <script>literal</script>' }],
    property_context: { offered_ids: ['a', 'b'] }, catalogo: [{ id: 'a', bedrooms: 3 }],
    lead: { presupuesto: '[dato protegido]' }, historial_reciente: '[resumen limitado]',
  }, respuesta_base: 'Una propuesta, no historial.' }
  const parts = promptContextParts(data)
  assert.equal(parts.map(p => p.text).join(''), JSON.stringify(data, null, 2))
  assert.ok(parts.some(p => p.kind === 'current' && p.text.includes('Y los precios?')))
  assert.ok(parts.some(p => p.kind === 'history' && p.text.includes('Departamentos y penthouses')))
  assert.ok(parts.some(p => p.kind === 'history' && p.text.includes('[resumen limitado]')))
  assert.ok(parts.some(p => p.kind === 'memory' && p.text.includes('[dato protegido]')))
  assert.ok(parts.some(p => p.kind === 'other' && p.text.includes('bedrooms')))
  assert.ok(parts.some(p => p.kind === 'other' && p.text.includes('Una propuesta, no historial.')))
})

const step = (order: number, key: string, output: Record<string, unknown> = {}, input: Record<string, unknown> = {}): WorkflowExecutionStep => ({ order, key, label: key, category: 'decision', status: 'succeeded', source: 'test', startedAt: '', completedAt: '', durationMs: 2, errorCode: null, input, output })
test('catalog explanation identifies inherited filters without inventing a no-results outcome', () => {
  const item = step(10, 'catalog_resolution', { query: { category: 'penthouse', filters: { bedrooms: 5 } } },
    { previous_query: { filters: { bedrooms: 5 } }, filters: { bedrooms: null } })
  const explanation = explainStep(execution([item]), item)
  assert.ok(explanation.found.some(f => f.label === 'Qué se conservó de la memoria' && f.value.includes('5')))
  assert.ok(explanation.found.some(f => f.label === 'Qué cambió'))
  assert.ok(!explanation.found.some(f => f.label === 'Resultado de la búsqueda registrada'))
})

test('pending messages remain alongside lead history before a conversation is assigned', () => {
  const old = { ...execution([]), id: 'old', leadGroupId: 'tenant:project:42', conversationId: 'conversation-1' }
  const pending = { ...old, id: 'new', conversationId: null, status: 'processing' }
  const unrelated = { ...pending, id: 'other', leadGroupId: 'tenant:other-project:42' }
  const groups = conversationGroups([pending, old, unrelated])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].batches.length, 2)
  assert.equal(groups[0].batches[0].execution.status, 'processing')
  assert.equal(conversationGroups([{ ...pending, conversationId: 'conversation-1', status: 'completed' }, old])[0].id, groups[0].id)
})

test('AI labels use recorded function and do not mislabel historical scope calls as writers', () => {
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'scope', task: 'writing' })), /Clasificador/)
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'writer', task: 'writing' })), /Redactor/)
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'extractor' })), /Extractor/)
  assert.match(stepTitle(step(1, 'model_request', {}, { task: 'writing' })), /histórica/)
})

test('invalid writer metadata separates rejection from advisor decision and never claims complete coverage', () => {
  const item = step(1, 'response_coverage', { status: 'invalid_coverage', requests: [], issues: ['requests[1].fragment: pregunta del bot'],
    needs_advisor: false, base_preview: 'Base', proposed_preview: 'Propuesta', final_preview: 'Base',
    decision: { reason: 'No se identificó un dato faltante que requiera derivación.' } })
  const result = explainStep(execution([item]), item)
  const sections = result.coverageSections!
  assert.equal(sections.length, 6)
  assert.match(sections[0].facts[0].value, /no se completó/)
  assert.match(sections[1].facts[0].value, /requests\[1\]/)
  assert.match(sections[3].facts[0].value, /No se registró/)
  assert.match(sections[4].facts[1].value, /Lista rechazada/)
  assert.match(sections[5].facts[0].value, /no solicitó/)
  assert.equal(result.reason, 'No se identificó un dato faltante que requiera derivación.')
})

test('joint validation explains the exact field, operator and evidence behind a rejection', () => {
  const item=step(1,'response_coverage',{status:'rejected_catalog_guard',final_validation:{passed:false,issues:['catalog_area_mismatch'],
    details:[{fragment:'23,01 m² interiores',field:'area_internal_m2',operator:'eq',received:[23.01],expected:[140.53]}]}})
  const facts=explainStep(execution([item]),item).coverageSections![1].facts
  const detail=facts.find(fact=>fact.label==='Dato comprobado')!.value
  assert.match(detail,/23,01 m² interiores/)
  assert.match(detail,/igual a/)
  assert.match(detail,/140.53/)
  assert.match(detail,/23.01/)
})

test('repair outcome and incomplete historical evidence remain distinct', () => {
  const item = step(1, 'response_coverage', { status: 'checked', repair_attempts: [{ status: 'invalid_coverage', issues: ['fragment'], final_status: 'checked' }],
    requests: [{ fragment: 'Quiero información', status: 'answered', evidence: 'Descripción del proyecto' }] })
  const sections = explainStep(execution([item]), item).coverageSections!
  assert.match(sections[3].facts[0].value, /Resultado final: Revisión completada/)
  assert.match(sections[4].facts[1].value, /Descripción del proyecto/)
  const old = step(2, 'response_coverage')
  const historical = explainStep(execution([old]), old).coverageSections!
  assert.match(historical[0].facts[0].value, /no se puede determinar/)
  assert.match(historical[5].facts[0].value, /No quedó registrado/)
  const other = step(3, 'message_delivery')
  assert.equal(explainStep(execution([other]), other).coverageSections, null)
})

test('reviewer metadata rejection exposes the literal fragment and bounded repair outcome', () => {
  const detail = { kind: 'review_metadata', code: 'review_fragment_not_in_reply', fragment: 'Texto tomado de la base', field: 'area_internal_m2', received: 120.83 }
  const item = step(1, 'response_coverage', { status: 'rejected_review', issues: ['invalid_review_metadata'],
    semantic_review: { validation_details: [detail] }, repair_attempts: [{ target: 'review_metadata', status: 'invalid_review_metadata', issues: [detail], final_status: 'rejected_review' }] })
  const sections = explainStep(execution([item]), item).coverageSections!
  assert.match(sections[1].facts[0].value, /Ficha interna/)
  assert.match(sections[1].facts[1].value, /citas que no aparecen literalmente/)
  assert.match(reviewDecision({semantic_review:{validation_details:[detail]}}).details[0], /Texto tomado de la base/)
  assert.match(sections[3].facts[0].label, /conservando el mensaje/)
})
const execution = (steps: WorkflowExecutionStep[], extra: Partial<WorkflowExecution> = {}): WorkflowExecution => ({ id: 'event-a', workflowId: 'overview', path: [], status: 'completed', action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: '', leadName: 'Consulta', message: 'Compare estas opciones', traceAvailable: true, steps, ...extra })

test('a comparison explains unlocked coverage without inventing a handoff reason', () => {
  const decision = step(3, 'dialogue_decision', { source: 'catalog_compare', catalog_query: { group: 'residential', category: 'departamento', operation: 'compare', filters: { bedrooms: null, floor_number: null } }, result_unit_ids: ['old-id'], coverage_locked: false, pending_question: { id: 'none' } })
  const explained = explainStep(execution([decision]), decision)
  assert.match(explained.reason, /No se guardó un motivo/)
  assert.match(explained.found.find(item => item.label === 'Revisión posterior')!.value, /no significa.*asesor/)
  assert.match(explained.found.find(item => item.label === 'Unidades encontradas')!.value, /sin número registrado/)
  assert.equal(explained.cause, null)
  assert.deepEqual(explained.linkedActions, [])
})

test('historical snapshots resolve unit numbers without reading future or live catalogue facts', () => {
  const snapshot = step(2, 'catalog_resolution', { catalog_snapshot: [{ id: 'unit-502', unit_number: '502', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 }] })
  const decision = step(3, 'dialogue_decision', { result_unit_ids: ['unit-502', 'unknown'] })
  const future = step(5, 'catalog_resolution', { catalog_snapshot: [{ id: 'unknown', unit_number: '999', category: 'local' }] })
  const explained = explainStep(execution([snapshot, decision, future]), decision)
  assert.equal(explained.units.length, 1)
  assert.equal(explained.units[0].unit_number, '502')
  const result = explained.found.find(item => item.label === 'Unidades encontradas')!.value
  assert.match(result, /departamento 502/)
  assert.match(result, /1 unidad sin número/)
  assert.doesNotMatch(result, /999/)
})

test('only an explicit causal step links a decision and a handoff, including incomplete actions', () => {
  const decision = step(3, 'response_coverage', { decision: { reason: 'Falta política verificada' } })
  const handoff = step(4, 'advisor_handoff', {}, { decision: { caused_by_step: 3, origin: 'coverage_review', reason: 'Verificar la política', rule_id: 'missing_fact', setting: { kind: 'data', label: 'Estado del proyecto', href: '/inmobiliaria/automatizacion/proyecto' } } })
  const unrelated = step(5, 'advisor_handoff', { decision: { reason: 'Otra solicitud' } })
  const run = execution([decision, handoff, unrelated])
  assert.deepEqual(explainStep(run, decision).linkedActions.map(item => item.order), [4])
  assert.equal(explainStep(run, handoff).cause?.order, 3)
  assert.equal(explainStep(run, handoff).origin, 'Revisión de cobertura')
  assert.equal(explainStep(run, handoff).setting?.href, '/inmobiliaria/automatizacion/proyecto')
  assert.equal(explainStep(run, unrelated).cause, null)
})

test('missing causal evidence stays missing and unsafe setting links are never actionable', () => {
  const handoff = step(4, 'advisor_handoff', { decision: { caused_by_step: 99, setting: { kind: 'prompt', href: 'javascript:alert(1)' } } })
  const explained = explainStep(execution([handoff]), handoff)
  assert.equal(explained.cause, null)
  assert.equal(explained.missingCause, true)
  assert.equal(explained.setting?.href, null)
  assert.match(humanValue('12345678-abcd-1234-abcd-123456789abc'), /Identificador interno/)
})

test('groups only recorded conversations and exact batches, never same-name contacts or nearby timestamps', () => {
  const input = [execution([], { id: '1', conversationId: 'c1', batchId: 'b1', batchSize: 3 }), execution([], { id: '2', conversationId: 'c1', batchId: 'b1', batchSize: 3 }), execution([], { id: '3', conversationId: 'c2' }), execution([], { id: '4' }), execution([], { id: '5' })]
  const groups = conversationGroups(input)
  assert.equal(groups.length, 4)
  assert.equal(groups[0].batches.length, 1)
  assert.equal(groups[0].batches[0].members.length, 2)
  assert.equal(groups[0].batches[0].total, 3)
  assert.equal(groups[2].known, false)
  assert.notEqual(groups[2].id, groups[3].id)
})

test('provider acceptance is never presented as delivery confirmation', () => {
  const delivery = step(6, 'message_delivery', { action: 'accepted', delivery_confirmed: false })
  assert.match(explainStep(execution([delivery]), delivery).summary, /no confirma entrega ni lectura/)
})
