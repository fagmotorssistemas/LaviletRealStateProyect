import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preferenceOptionsReply, progressivePendingQuestion, progressiveQuestionIssues } from './progressive-options'
import { catalogDialogueReply, validateCatalogReply } from './catalog-dialogue'

const catalog = [
  { id: 'p1', category: 'penthouse', unit_number: '801', bedrooms: 3, floor_number: 8, floor: 'Octava Planta Alta', published_commercial_price: 550000 },
  { id: 'p2', category: 'penthouse', unit_number: '802', bedrooms: 3, floor_number: 8, floor: 'Octava Planta Alta', published_commercial_price: 550000 },
  { id: 'p3', category: 'penthouse', unit_number: '803', bedrooms: 2, floor_number: 8, published_commercial_price: 450000 },
  { id: 'd1', category: 'departamento', unit_number: '201', bedrooms: 3, floor_number: 2, published_commercial_price: 310000 },
  { id: 'd2', category: 'departamento', unit_number: '401', bedrooms: 3, floor_number: 4, published_commercial_price: 320000 },
  { id: 'd3', category: 'departamento', unit_number: '402', bedrooms: 2, floor_number: 4, published_commercial_price: 210000 },
  { id: 's1', category: 'suite', unit_number: '301', bedrooms: 1, floor_number: 3, published_commercial_price: 150000 },
]
const info = (reason: string, filters: object, kind = 'fewer_bedrooms') => ({ catalogo: catalog,
  politica_comercial: { precios_autorizados: true }, referencia_unidad: { reason },
  property_context: { query: { group: 'residential', operation: 'search', filters },
    preference_transition: { kind, active: true, source_bedrooms: 3, source_selected_ids: [], source_offered_ids: ['p1', 'p2'] } } })

test('fewer bedrooms presents only eligible category summaries, without selecting a unit or promising cheaper prices', () => {
  const result = preferenceOptionsReply(info('requested_fewer_bedrooms', { bedrooms_any: [1, 2] }))!
  assert.match(result.reply, /departamentos de 2 dormitorios/)
  assert.match(result.reply, /penthouses de 2 dormitorios/)
  assert.match(result.reply, /suites de 1 dormitorio/)
  assert.doesNotMatch(result.reply, /3 dormitorios|201|401|801|802|económic|360/)
  assert.equal(validateCatalogReply(result.reply, result.audit).valid, true)
  assert.deepEqual(result.audit.selected_unit_ids, [])
  assert.deepEqual(new Set(result.audit.offered_unit_ids as string[]), new Set(['p3', 'd3', 's1']))
  const exact = preferenceOptionsReply(info('requested_fewer_bedrooms', { bedrooms: 2 }))!
  assert.doesNotMatch(exact.reply, /suite|1 dormitorio/)
})

test('a bare cheaper request clarifies the known bedroom requirement without offering other categories yet', () => {
  const result = preferenceOptionsReply(info('cheaper_requires_bedrooms_confirmation', { bedrooms: 3 }, 'cheaper'))!
  assert.equal(result.reply, '¿Desea que mantengamos los 3 dormitorios al buscar opciones más económicas?')
  assert.deepEqual(result.audit.offered_unit_ids, [])
  assert.equal((result.audit.pending_question as { act: string }).act, 'confirm_bedrooms')
  const constrained = preferenceOptionsReply(info('cheaper_requires_bedrooms_confirmation', { bedrooms: 3, floor_number: 4, min_area_m2: 90 }, 'cheaper'))!
  const pending = constrained.audit.pending_question as { proposed_query: { filters: { floor_number: number; min_area_m2: number } } }
  assert.equal(pending.proposed_query.filters.floor_number, 4)
  assert.equal(pending.proposed_query.filters.min_area_m2, 90)
})

test('cheaper with three bedrooms only offers strictly cheaper verified three-bedroom units', () => {
  const result = preferenceOptionsReply(info('requested_cheaper_options', { bedrooms: 3 }, 'cheaper'))!
  assert.match(result.reply, /más económicas.*departamentos de 3 dormitorios/)
  assert.doesNotMatch(result.reply, /suite|penthouse|2 dormitorios|1 dormitorio|¿Qué planta/)
  assert.deepEqual(result.audit.offered_unit_ids, ['d1', 'd2'])
  assert.equal((result.audit.pending_question as { act: string }).act, 'explore_alternatives')
  assert.equal(validateCatalogReply(result.reply, result.audit).valid, true)
  const noPrices = preferenceOptionsReply({ ...info('requested_cheaper_options', { bedrooms: 3 }, 'cheaper'), politica_comercial: { precios_autorizados: false } })!
  assert.match(noPrices.reply, /todavía no hay precios comparables verificados/)
  assert.doesNotMatch(noPrices.reply, /Contamos con opciones más económicas/)
})

test('accepting a changed category asks for available floor before enumerating unit specifications', () => {
  const context = { query: { group: 'residential', category: 'departamento', operation: 'search', scope: 'offered', filters: { bedrooms: 3 } },
    offered_ids: ['d1', 'd2'], preference_transition: { active: true, kind: 'cheaper' } }
  const result = catalogDialogueReply({ catalogo: catalog, property_context: context })!
  assert.match(result.reply, /departamentos de 3 dormitorios.*planta 2 y planta 4/i)
  assert.match(result.reply, /¿Qué planta prefiere\?/)
  assert.doesNotMatch(result.reply, /201|401|interiores|exteriores|360/)
})

test('validated paraphrases keep the offered IDs and quoted-details action', () => {
  const audit = { pending_question: { id: 'unit_choice', act: 'explore_quoted_options', candidate_ids: ['p1', 'p2'], question: '¿Le gustaría obtener más detalles de alguna de estas opciones?' },
    progressive_selection: { stage: 'offer_details', question: '¿Le gustaría obtener más detalles de alguna de estas opciones?' } }
  const reply = 'Penthouses de 3 dormitorios: 801 y 802. ¿Desea conocerlos con más detalle?'
  assert.deepEqual(progressiveQuestionIssues(reply, audit, 'offer_verified_material'), [])
  assert.deepEqual(progressivePendingQuestion(reply, audit), { ...audit.pending_question, question: '¿Desea conocerlos con más detalle?' })
  assert.deepEqual(progressiveQuestionIssues('Información de las opciones.', audit), ['commercial_next_question_missing'])
  assert.deepEqual(progressiveQuestionIssues('Opciones verificadas. ¿Quiere agendar una visita?', audit), ['commercial_next_question_changed'])
  assert.deepEqual(progressiveQuestionIssues('Opciones verificadas. Quiere agendar una visita?', audit), ['commercial_next_question_changed'])
  assert.deepEqual(progressivePendingQuestion('Penthouses de 3 dormitorios: 801 y 802. Desea conocerlos con más detalle?', audit), {
    ...audit.pending_question, question: 'Desea conocerlos con más detalle?' })
  assert.deepEqual(progressiveQuestionIssues('¿Cuál de estas opciones le gustaría visitar virtualmente?', audit, 'choose_property'), [])
})

test('accepting the cheaper category advances after bedroom confirmation instead of offering it again', () => {
  const confirmed = preferenceOptionsReply(info('accepted_bedroom_confirmation', { bedrooms: 3 }, 'cheaper'))!
  assert.deepEqual(confirmed.audit.offered_unit_ids, ['d1', 'd2'])
  assert.equal(preferenceOptionsReply(info('accepted_alternative_query', { bedrooms: 3 }, 'cheaper')), null)
})

test('cheaper and fewer bedrooms both constrain the alternatives, including when no smaller unit exists', () => {
  const base = info('requested_cheaper_options', { bedrooms_any: [1, 2] }, 'cheaper')
  const combined = { ...base, property_context: { ...base.property_context,
    preference_transition: { ...base.property_context.preference_transition, fewer_bedrooms: true } } }
  const result = preferenceOptionsReply(combined)!
  assert.deepEqual(new Set(result.audit.offered_unit_ids as string[]), new Set(['p3', 'd3', 's1']))
  const absent = preferenceOptionsReply({ ...combined, catalogo: catalog.filter(unit => unit.bedrooms === 3),
    property_context: { ...combined.property_context, query: { ...combined.property_context.query, filters: {} } } })!
  assert.deepEqual(absent.audit.offered_unit_ids, [])
  assert.match(absent.reply, /No aparecen opciones/)
})

test('a cheaper request explicitly restricted to penthouses does not offer other categories', () => {
  const base = info('requested_cheaper_options', { bedrooms: 2 }, 'cheaper')
  const result = preferenceOptionsReply({ ...base,
    property_context: { ...base.property_context, query: { ...base.property_context.query, category: 'penthouse' } } })!
  assert.deepEqual(result.audit.offered_unit_ids, ['p3'])
  assert.match(result.reply, /más económicas.*penthouses de 2 dormitorios/)
  assert.doesNotMatch(result.reply, /departamentos|suites/)
})

test('a tour URL query marker cannot replace the planned post-tour commercial question', () => {
  const question = '¿Qué presupuesto aproximado tiene previsto para la compra?'
  const audit = { post_tour_continuation: { question }, pending_question: { id: 'budget_amount', question, act: 'budget' } }
  const tour = 'Aquí tiene el recorrido https://www.lavilett.com/tour?unidad=801'
  assert.deepEqual(progressiveQuestionIssues(tour, audit), ['commercial_next_question_missing'])
  assert.deepEqual(progressivePendingQuestion(tour, audit), {})
  assert.deepEqual(progressivePendingQuestion(tour + '\n' + question, audit), audit.pending_question)
})
