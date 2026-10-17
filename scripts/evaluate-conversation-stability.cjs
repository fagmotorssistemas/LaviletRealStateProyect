/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic conversation evaluation. */
// Uses the real interpreter, planner, memory and final writer. All external
// operations are synthetic receipts; the only permitted network host is OpenAI.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'), false, { info() {}, error() {} })
require('./test-typescript.cjs')
const { aiJson, mediaText } = require('../src/lib/integrations/automation/ai.ts')
const { interpretConversationTurn, rememberInterpretedTurn } = require('../src/lib/integrations/automation/turn-interpretation.ts')
const { resolveTurnIntent } = require('../src/lib/integrations/automation/turn-intent.ts')
const { resolvePropertyTurn, rememberPropertyReply } = require('../src/lib/integrations/automation/property-context.ts')
const { commercialJourneyPlan, rememberCommercialJourney } = require('../src/lib/integrations/automation/commercial-journey.ts')
const { rememberSalesReply } = require('../src/lib/integrations/automation/sales-policy.ts')
const { leadIntroductionTurn, rememberLeadIntroduction } = require('../src/lib/integrations/automation/lead-introduction.ts')
const { confirmedLeadProfile, mergeLeadProfile } = require('../src/lib/integrations/automation/lead-profile.ts')
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { withResponseReviewPolicy } = require('../src/lib/integrations/automation/response-review-policy.ts')
const { responseReviewSettings } = require('../src/lib/inmobiliaria/responseReview.ts')
const { interactionMode } = require('../src/lib/integrations/automation/interaction-mode.ts')
const { classifyBusinessScope, reconcileConversationScope } = require('../src/lib/integrations/automation/business-scope.ts')
const { DEFAULT_TONE } = require('../src/lib/inmobiliaria/conversationTone.ts')
const { executionCost } = require('../src/components/inmobiliaria/automation/workflow/executionCost.ts')
const { object } = require('../src/lib/integrations/automation/data.ts')
const { deliveredPendingQuestion } = require('../src/lib/integrations/automation/continuation-question.ts')
const { projectReservationOperation } = require('../src/lib/integrations/automation/reservation-operation-context.ts')
const { visitDialogueTurn, rememberVisitDialogue } = require('../src/lib/integrations/automation/visit-dialogue.ts')
const { resolveVisitCalendar } = require('../src/lib/integrations/automation/visit-calendar.ts')
const args = process.argv.slice(2), arg = (key, value) => args.includes(key) ? args[args.indexOf(key) + 1] : value
const live = args.includes('--live'), maxCalls = Number(arg('--max-calls', '48')), maxUsd = Number(arg('--max-usd', '3'))
const destination = arg('--out', 'tmp/conversation-stability/live-evaluation.json')
const selected = arg('--case', '').split(',').filter(Boolean)
const clone = value => structuredClone(value)
const catalog = [
  { id: 'eval-d302', category: 'departamento', unit_number: '302', bedrooms: 3, bathrooms_full: 2, floor_number: 3,
    area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 300000 },
  { id: 'eval-p602', category: 'penthouse', unit_number: '602', bedrooms: 3, bathrooms_full: 3, floor_number: 6,
    area_internal_m2: 140.53, area_exterior_m2: 25.3, published_commercial_price: 341016 },
  { id: 'eval-p605', category: 'penthouse', unit_number: '605', bedrooms: 3, bathrooms_full: 2, floor_number: 6,
    area_internal_m2: 142.09, area_exterior_m2: 27.2, published_commercial_price: 337272 },
  { id: 'eval-l01', category: 'local', unit_number: 'LC01', bedrooms: 0, bathrooms_full: 1, floor_number: 0,
    area_internal_m2: 70, area_exterior_m2: 0, published_commercial_price: 155000 },
].map(unit => ({ ...unit, is_published: true, status: 'disponible', tour_url: 'https://example.com/tour/' + unit.unit_number }))
const verified = {
  proyecto: { name: 'La Vilet', address: 'Puertas del Sol, Cuenca', description: 'Proyecto de uso mixto con viviendas y dos plantas comerciales.' },
  configuracion_presentacion_proyecto: { available: true, summary: 'La Vilet es un proyecto de uso mixto en Puertas del Sol, Cuenca, con suites, departamentos, penthouses y dos plantas comerciales.', source: 'synthetic_approved' },
  catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
  instalaciones: [{ id: 'security', amenity_name: 'Sistemas de seguridad 24h', description: 'Vigilancia permanente y sistemas de monitoreo' },
    { id: 'access', amenity_name: 'Accesos independientes', description: 'Accesos separados para viviendas y comercios' }],
  lugares_cercanos: [], contexto_sector: [], politicas_negocio: [],
  financiamiento: { partners: ['Cooperativa JEP'], current: {} },
  estado_proyecto: { stage: 'not_started', verifiedOn: '2026-10-16', enabledPlaces: ['office'], primaryPlace: 'office', officeAtProjectSite: true },
}
const cases = [
  { id: 'opening-security-trust', messages: ['Saludos, quiero información por favor', 'Me llamo Elena y resido actualmente en Loja',
    '¿En qué sector queda?', 'Pero es una zona segura?', 'No me da confianza esa explicación'],
    check(turns) {
      assert.equal(turns[0].mode, 'guided_search')
      assert.equal(turns[0].profile_decision.action, 'capture')
      assert.ok(turns[0].receipts.project_presented)
      assert.equal(turns[1].profile.full_name, 'Elena')
      assert.equal(turns[1].profile.residence_city, 'Loja')
      assert.equal(turns[1].receipts.brochure_shared, true, 'a completed profile receives the promised brochure in this turn')
      assert.match(turns[1].reply, /https:\/\/www\.lavilett\.com\/materiales\//)
      assert.ok(turns[3].writer_facts.some(fact => fact.id === 'security'))
      assert.ok(turns[4].requests.some(request => request.topics.includes('value_objection')))
      assert.ok(turns[4].writer_facts.some(fact => fact.id === 'security'))
      for (const turn of turns.slice(3)) assert.doesNotMatch(turn.reply,
        /no (?:cuento|tengo|contamos|tenemos).{0,45}(?:indicadores|estad.sticas)|no.{0,25}garanti|no (?:son|es).{0,35}(?:valoraci|evaluaci)|eso no permite|no debí/i)
    } },
  { id: 'explicit-pause', messages: ['Quiero información del proyecto pero por ahora no quiero que me hagan preguntas de compra',
    '¿Qué precios tienen los penthouses?', 'Ahora sí quiero que me ayuden a escoger una vivienda'],
    check(turns) { assert.equal(turns[0].mode, 'information_only'); assert.equal(turns[1].mode, 'information_only')
      assert.equal(turns[0].profile_decision.action, 'defer'); assert.equal(turns[2].mode, 'guided_search') } },
  { id: 'selected-reservation-continuity', summary: { _lead_profile: { full_name: 'Elena', name_status: 'confirmed',
    residence_city: 'Loja', residence_status: 'confirmed', evidence: { full_name: 'Me llamo Elena' },
    sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Elena' } } }, _lead_introduction: { version: 3, status: 'complete',
    brochure_sent: true, presentation_sent: true, collection_status: 'complete' }, _property_context: {
      selected_ids: ['eval-p605'], offered_ids: ['eval-p602', 'eval-p605'],
      exploration_state: { accepted_filters: { bedrooms: 3 } },
      query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 }, scope: 'selected', operation: 'none' } } },
    history: [{ role: 'cliente', content: 'Buscaba cinco dormitorios, pero acepto explorar tres y elijo el 605' },
      { role: 'bot', content: 'Podemos continuar con el penthouse 605 de tres dormitorios.' }],
    messages: ['¿Qué precio tenía el 605?', 'Quiero iniciar la reserva del 605', 'Lo de antes fue un error, todavía nadie me ha llamado'],
    check(turns) { for (const turn of turns) assert.deepEqual(turn.selected, ['eval-p605'])
      assert.equal(turns[1].reservation_authorized, true)
      assert.equal(turns[2].reservation_authorized, false)
      assert.notEqual(turns[2].plan.question_id, 'property_requirements')
      for (const turn of turns) assert.notEqual(turn.profile_decision.action, 'capture') } },
  { id: 'visit-time-before-day', messages: ['Quiero coordinar una visita a la oficina', 'A las tres de la tarde',
    'O sea, el miércoles 21 de octubre', 'Sí, justamente para esa fecha'],
    check(turns) {
      assert.equal(turns[1].visit_preference.has_time, true)
      assert.equal(turns[1].visit_preference.requested_date, null)
      assert.equal(turns[2].visit_preference.start_time, '2026-10-21T20:00:00.000Z')
      assert.equal(turns[2].visit_registered, true)
      assert.equal(turns[3].visit_registered, true)
      for (const turn of turns) assert.doesNotMatch(turn.reply, /esto no confirma|debe revisarse antes de confirmar|no est[áa] confirmada/i)
    } },
]
cases.push({ id: 'requirements-to-selected-home', summary: clone(cases.find(item => item.id === 'selected-reservation-continuity').summary),
  messages: ['Busco un departamento de cinco dormitorios, ¿qué precio tiene?',
    'Sí, podemos revisar opciones de tres dormitorios', 'Prefiero penthouse porque busco más espacio',
    '¿Cuál es la diferencia entre el 602 y el 605 aparte del precio?', 'Me quedo con el 605, ¿qué precio tiene?'],
  check(turns) {
    assert.equal(turns[0].requests.some(request => request.topics.includes('purchase_price')), true)
    assert.equal(turns[1].selected.length, 0, 'accepting alternatives must not select a home')
    assert.equal(turns[1].property_context.query.filters.bedrooms, 3, 'the accepted alternative becomes the current exploration')
    for (const turn of turns.slice(2)) assert.notEqual(turn.plan.action, 'clarify_requirements',
      'do not ask again for an alternative the customer has accepted')
    assert.deepEqual(turns.at(-1).selected, ['eval-p605'])
    assert.match(turns.at(-1).reply, /337[.,]272/)
    assert.notEqual(turns.at(-1).plan.question_id, 'property_requirements')
    for (const turn of turns) assert.notEqual(turn.profile_decision.action, 'capture')
  } })
// This begins with an identified contact, without a previously selected unit.
cases.at(-1).summary._property_context = {}
cases.push({ id: 'brochure-content-before-decision', useScope: true,
  messages: ['Quiero información sobre el proyecto', 'Qué incluye ese brochure para ver si le comparto mi información',
    'Oh ya', 'Me llamo Elena', 'Actualmente resido en Loja'],
  check(turns) {
    assert.equal(turns[0].profile_decision.action, 'capture')
    for (const turn of turns.slice(1, 4)) {
      assert.equal(turn.receipts.brochure_shared, false)
      assert.doesNotMatch(turn.reply, /https?:\/\//)
      assert.equal(turn.saved_introduction.brochure_decision_pending, true)
    }
    assert.equal(turns[1].scope.kind, 'property')
    assert.equal(turns[1].introduction.material_question, true)
    assert.ok(!turns[1].question?.continuation_id)
    assert.equal(turns[2].saved_introduction.reminder_count, 0)
    assert.deepEqual(turns[3].profile_decision.allowed_fields, ['current_residence'])
    assert.equal(turns[4].receipts.brochure_shared, true)
  } })
cases.push({ id: 'contextual-commercial-choice', useScope: true,
  summary: { ...clone(cases.find(item => item.id === 'selected-reservation-continuity').summary), _property_context: {},
    _pending_question: { id: 'property_category', act: 'choose_category', question: '¿Le interesa una vivienda o un local comercial?' } },
  history: [{ role: 'bot', content: '¿Le interesa una vivienda o un local comercial?' }],
  messages: ['oh gracias\nbueno me interesa algo comercial', '¿Qué opciones tienen en planta baja?', 'En realidad prefiero una vivienda'],
  check(turns) {
    assert.equal(turns[0].scope.kind, 'property')
    assert.equal(turns[0].semantics.property.group, 'commercial')
    assert.equal(turns[0].semantics.property.category, 'local')
    for (const turn of turns) assert.notEqual(turn.plan.action, 'discover_use')
    assert.equal(turns[1].property_context.query.group, 'commercial')
    assert.equal(turns[2].semantics.property.group, 'residential')
    for (const turn of turns) assert.doesNotMatch(turn.reply, /(?:vivienda.{0,20}o.{0,20}local|local.{0,20}o.{0,20}vivienda)/i)
  } })
const suiteCatalog = [['206', 2, 99720], ['207', 2, 99720], ['505', 5, 114678], ['508', 5, 169878]].map(([id, floor, price]) => ({
  id: 'eval-s' + id, unit_number: id, category: 'suite', bedrooms: 1, bathrooms_full: 1, floor_number: floor,
  area_internal_m2: id === '508' ? 73.86 : 49.86, area_exterior_m2: 12.68, spaces: id === '508' ? ['Balcón', 'Estudio'] : ['Balcón'],
  published_commercial_price: price, status: 'disponible', is_published: true,
}))
cases.push({ id: 'carlos-batched-full-flow', useScope: true, catalog: [...catalog, ...suiteCatalog],
  messages: [
    ['Hola', 'Buenas noches podría ayudarme con info porfavor'],
    ['Y que incluye ese brochure?', 'Bueno me llamo Carlos'],
    ['Bueno envíeme el brochure por favor', 'Para ver más sobre el proyecto'],
    ['Muchas gracias', 'Y qué precios tiene?'],
    ['Entiendo', 'Pero si estan caros'], 'Bueno está bien',
    ['Entiendo mejor suites', 'Quieor algo pequeño'],
    ['Bueno más o menos unos 100 mil tengo pensado gastar', 'Para esta compra'],
    'Oh ya, y en la última planta no tiene algo disponible?',
    'Y qué precio tiene las de la quinta planta?',
    ['Y más arriba tiene algo disponible?', 'O sea en otro piso más alto'],
  ], check(turns) {
    assert.equal(turns[1].semantics.communication.kind, 'substantive')
    assert.equal(turns[1].profile.full_name, 'Carlos')
    assert.deepEqual(turns[1].profile_decision.allowed_fields, ['current_residence'])
    assert.equal(turns[1].receipts.brochure_shared, false)
    assert.equal(turns[1].question.continuation_id, 'lead_profile_residence')
    assert.equal(turns[2].receipts.brochure_shared, true)
    assert.equal(turns[2].question.continuation_id, 'property_category')
    assert.equal(turns[3].plan.action, 'answer_current_question')
    assert.equal(turns[6].plan.question_id, 'budget_amount')
    assert.deepEqual(turns[7].plan.selection_scope.unit_ids.sort(), ['eval-s206', 'eval-s207'])
    assert.equal(turns[8].plan.action, 'explore_floor_options')
    assert.deepEqual(turns[8].plan.selection_scope.floors, [5])
    assert.equal(turns[8].plan.budget_guidance.comparison.coverage, 'none')
    assert.equal(turns[10].semantics.communication.kind, 'substantive')
    assert.equal(turns[10].plan.action, 'explore_floor_options')
    assert.equal(turns[10].plan.floor_exploration.matching_unit_ids.length, 0)
    assert.equal(turns[10].plan.floor_exploration.highest_available_floor, 5)
    for (const index of [8, 9, 10]) {
      assert.doesNotMatch(turns[index].reply, /206|207/)
      assert.equal(turns[index].selected.length, 0)
    }
  } })
cases.push({ id: 'brochure-mixed-profile-variant', useScope: true,
  messages: ['Buenas, me ayuda con información del proyecto porfa',
    ['¿Qué viene en ese PDF?', 'Me puede llamar Elena'], 'Actualmente vivo en Loja'],
  check(turns) {
    assert.equal(turns[1].semantics.communication.kind, 'substantive')
    assert.deepEqual(turns[1].profile_decision.allowed_fields, ['current_residence'])
    assert.equal(turns[1].question.continuation_id, 'lead_profile_residence')
    assert.equal(turns[1].receipts.brochure_shared, false)
    assert.equal(turns[2].receipts.brochure_shared, true)
    assert.equal(turns[2].profile.residence_city, 'Loja')
  } })
cases.push({ id: 'floor-batched-reference-variant', useScope: true, catalog: [...catalog, ...suiteCatalog],
  summary: { _lead_profile: { full_name: 'Elena', name_status: 'confirmed', residence_city: 'Loja', residence_status: 'confirmed' },
    _lead_introduction: { status: 'complete', brochure_sent: true, presentation_sent: true, request_sent: true },
    _interpretation_memory: { budget: { status: 'maximum_total', amount: 100000, confidence: 'high', evidence: 'unos 100 mil para esta compra' },
      property: { category: 'suite', group: 'residential', confidence: 'high', evidence: 'quiero una suite' } },
    _property_context: { query: { group: 'residential', category: 'suite', operation: 'search', scope: 'catalog', filters: {} },
      offered_ids: ['eval-s206', 'eval-s207'], selected_ids: [], pending_question: { id: 'unit_choice', act: 'choose_unit', candidate_ids: ['eval-s206', 'eval-s207'] } } },
  messages: [['¿Qué hay en el piso más alto?', 'Estoy hablando de suites'], '¿Y cuánto cuestan las de la quinta planta?', ['¿Y arriba de eso?', '¿En el piso siguiente?']],
  check(turns) {
    assert.equal(turns[0].plan.action, 'explore_floor_options')
    assert.deepEqual(turns[0].plan.selection_scope.floors, [5])
    assert.equal(turns[0].plan.budget_guidance.comparison.coverage, 'none')
    assert.equal(turns[1].property_context.current_floor_query, undefined)
    assert.equal(turns[2].plan.action, 'explore_floor_options')
    assert.equal(turns[2].plan.floor_exploration.matching_unit_ids.length, 0)
    for (const turn of turns) assert.doesNotMatch(turn.reply, /206|207/)
  } })
const apartmentCatalog = [2, 3, 4, 5].flatMap(floor => [
  { id: 'eval-d' + floor + '02', unit_number: floor + '02', bedrooms: 3, floor_number: floor, area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 229577 + floor * 7000 },
  ...(floor === 2 ? [] : [{ id: 'eval-d' + floor + '04', unit_number: floor + '04', bedrooms: 2, floor_number: floor, area_internal_m2: 109.69, area_exterior_m2: 34.59, published_commercial_price: 230349 + (floor - 3) * 10969 }]),
].map(unit => ({ ...unit, category: 'departamento', bathrooms_full: 2, status: 'disponible', is_published: true })))
cases.push({ id: 'residence-and-bedroom-scope', useScope: true, catalog: apartmentCatalog,
  messages: ['¿Cuál es el precio base de los departamentos de 2 habitaciones?', ['gracias', 'me llamo carlos', 'vivi en ecuador'],
    'Ahora vivo en Loja', 'Aún no lo tengo definido la verdad',
    '¿Esas medidas son solo de los departamentos de dos habitaciones o también de los de tres?'],
  check(turns) {
    assert.equal(turns[1].profile.residence_status, 'unknown')
    assert.equal(turns[1].profile.declared_location.country, 'Ecuador')
    assert.equal(turns[1].writer_contract.estado_comercial.brochure.accion, 'await_profile')
    assert.equal(turns[1].writer_contract.estado_comercial.objetivo_presentacion.offer_project_brochure, false)
    assert.doesNotMatch(turns[1].reply, /brochure|folleto|informaci.n y planos/i)
    assert.equal(turns[1].question.continuation_id, 'lead_profile_residence')
    assert.equal(turns[2].profile.residence_city, 'Loja')
    assert.equal(turns[2].receipts.brochure_shared, true)
    assert.equal(turns[3].plan.presentation, 'floors')
    assert.deepEqual(turns[3].writer_evidence.presentation_scope.bedroom_counts, [2])
    assert.ok(turns[3].writer_evidence.units.every(unit => unit.bedrooms === 2))
    assert.match(turns[3].reply, /(?:2|dos) (?:dormitorios|habitaciones)/i)
    assert.doesNotMatch(turns[3].reply, /120[,.]83|27[,.]03/)
    assert.ok(turns[4].writer_evidence.units.some(unit => unit.bedrooms === 3))
  } })
cases.push({ id: 'visual-luna', visual: true, messages: [] })
for (const id of selected) if (!cases.some(fixture => fixture.id === id)) throw Error('EVALUATION_UNKNOWN_CASE: ' + id)
const realFetch = global.fetch, measurements = [], requests = [], results = []
const cost = usage => executionCost(usage.map(item => ({ key: 'model_request', input: { model: item.model }, output: { token_usage: item.usage } }))).estimatedUsd
global.fetch = async (url, options) => {
  if (!live || String(url) !== 'https://api.openai.com/v1/responses' || options?.method !== 'POST') throw Error('EVALUATION_NETWORK_BOUNDARY')
  const body = JSON.parse(options.body)
  const ceiling = cost([{ model: body.model, usage: { input_tokens: Buffer.byteLength(options.body) + 1024,
    cached_input_tokens: 0, output_tokens: body.max_output_tokens } }])
  if (requests.length >= maxCalls || !Number.isFinite(ceiling) || cost(measurements) + ceiling > maxUsd) throw Error('EVALUATION_BUDGET_LIMIT')
  const record = { model: body.model, startedAt: new Date().toISOString() }; requests.push(record)
  const response = await realFetch(url, { ...options, redirect: 'error' })
  const payload = await response.clone().json()
  if (payload.usage) {
    record.usage = { input_tokens: payload.usage.input_tokens, cached_input_tokens: payload.usage.input_tokens_details?.cached_tokens || 0,
      output_tokens: payload.usage.output_tokens }
    measurements.push({ model: body.model, usage: record.usage })
  }
  record.status = response.status
  return response
}
let lastWriterContext = {}, lastExtraction = {}, currentExtractions = []
const generate = async (rules, input, schema, _image, _file, _tone, task = 'data') => {
  if (task === 'writing') lastWriterContext = clone(input)
  const output = await aiJson(rules, input, schema, undefined, undefined, DEFAULT_TONE, task)
  if (schema?.properties?.turn_semantics) { lastExtraction = clone(output); currentExtractions.push(clone(output)) }
  return output
}
const save = () => {
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, JSON.stringify({ capturedAt: new Date().toISOString(), live, externalOperations: 'synthetic',
    databaseWrites: false, realMessages: false, reviewerEnabled: false, maxCalls, maxUsd,
    estimatedUsd: cost(measurements), modelRequests: requests, results }, null, 2) + '\n')
}
async function run() {
  if (!live) { results.push(...cases.filter(c => !selected.length || selected.includes(c.id)).map(c => ({ id: c.id, status: 'dry_run', turns: c.messages.length }))); save(); return }
  if (!process.env.OPENAI_API_KEY) throw Error('OPENAI_NOT_CONFIGURED')
  const extractorPrompt = fs.readFileSync('supabase/prompts/extractor-eventos.md', 'utf8')
  for (const fixture of cases.filter(c => !selected.length || selected.includes(c.id))) {
    const caseCatalog = fixture.catalog || catalog
    const record = { id: fixture.id, turns: [], status: 'running' }; results.push(record)
    if (fixture.visual) {
      const download = require('../src/lib/integrations/automation/media-download.ts'), previousDownload = download.downloadMedia
      try {
        const bytes = await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="220"><rect width="100%" height="100%" fill="white"/><text x="30" y="70" font-size="36" fill="black">LOCAL COMERCIAL 05</text><text x="30" y="135" font-size="30" fill="black">Area interior: 70 m2</text></svg>')).png().toBuffer()
        download.downloadMedia = async () => ({ bytes, mime: 'image/png' })
        const result = await mediaText({ text: '', media: { type: 'image', url: 'https://example.com/synthetic.png' } })
        assert.match(result, /LOCAL COMERCIAL 05/i)
        assert.match(result, /70/)
        assert.equal(requests.at(-1).model, 'gpt-6-luna')
        record.turns.push({ synthetic: true, description: result, model: requests.at(-1).model })
        record.status = 'passed'
      } catch (error) { record.status = 'failed'; record.error = error.message }
      finally { download.downloadMedia = previousDownload }
      save()
      console.log(JSON.stringify({ case: fixture.id, status: record.status, description: record.turns[0]?.description, error: record.error }))
      continue
    }
    let summary = clone(fixture.summary || {}), history = clone(fixture.history || []), reservation = null
    let calendar = {}, visitRequest = null, visitState = {}, slot = {}
    try {
      for (const [index, turn] of fixture.messages.entries()) {
        currentExtractions = []
        const catalog = caseCatalog
        const messages = Array.isArray(turn) ? turn : [turn], current = messages.join('\n')
        const sourceId = 'synthetic-' + fixture.id + '-' + index
        const classified = fixture.useScope ? await classifyBusinessScope(current, history, true, object(summary._turn_intent).scope, summary._pending_question)
          : { kind: 'property', property_message: current, uncertain: false }
        let interpreted = await interpretConversationTurn({ mensaje_actual: current, source_message_id: sourceId,
          source_at: '2026-10-16T21:00:00Z', current_messages: messages.map((content, i) => ({ external_message_id: sourceId + '-' + i, content, sent_at: '2026-10-16T21:00:00Z' })),
          historial: history.slice(-10), resumen: summary, contexto_propiedades: summary._property_context,
          catalogo_unidades: catalog, pregunta_pendiente: summary._pending_question, perfil_inicial: summary._lead_profile,
          reservation_context: reservation ? projectReservationOperation({ catalog, lead: { id: 'synthetic-lead',
            assigned_to: 'synthetic-advisor', handoff_status: 'assigned' }, requests: [{ ...reservation,
            id: reservation.request_id, lead_id: 'synthetic-lead' }] }) : undefined,
          coordinacion_visita: visitState }, { activePrompt: async () => extractorPrompt, aiJson: generate })
        const scopeDecision = fixture.useScope
          ? await reconcileConversationScope(classified, current, interpreted.requests, history, summary._pending_question) : classified
        if (scopeDecision.kind === 'property') interpreted = interpreted.withActionMessage?.(current) || interpreted
        const semantics = interpreted.semantics
        const profile = confirmedLeadProfile(mergeLeadProfile(summary._lead_profile, interpreted.extracted.lead_profile))
        const property = resolvePropertyTurn(catalog, current, summary, history, semantics)
        const intent = resolveTurnIntent({ current, history, semantics, requests: interpreted.requests, scope: scopeDecision,
          previous: summary._turn_intent, pendingQuestion: summary._pending_question })
        const mode = interactionMode(summary._interaction_mode, semantics)
        let audit = { source: 'commercial', resolved_turn_intent: intent, catalog_query: property.query,
          writer_greeting: index === 0 && !history.length ? 'Buenas tardes' : '' }
        const authorized = object(semantics.action_authority).reservation
        const reservationAuthorized = object(authorized).attribution === 'self' && ['request', 'accept'].includes(object(authorized).decision)
        if (reservationAuthorized) {
          reservation = { request_id: 'synthetic-reservation', request_status: 'requested', handoff_status: 'assigned',
            assigned_to: 'synthetic-advisor', unit_ids: ['eval-p605'] }
          audit = { ...audit, source: 'reservation_handoff', action: 'submitted', registration_verified: true,
            reservation: { ...reservation, kind: 'request', handoff_verified: true, advisor_assigned: true } }
        }
        const visit = interpreted.extracted.visit_intent
        let dialogue
        if (fixture.id === 'visit-time-before-day') {
          dialogue = visitDialogueTurn({ previous: visitState, current, intent: visit, preference: interpreted.extracted.visit_preference,
            preferences: interpreted.extracted.visit_preferences, readiness: verified.estado_proyecto,
            sourceMessageId: sourceId, sourceAt: '2026-10-16T21:00:00Z', pendingQuestion: summary._pending_question })
          if (interpreted.extracted.visit_preference) {
            slot = resolveVisitCalendar(interpreted.extracted.visit_preference, { sourceAt: '2026-10-16T21:00:00Z',
              timezone: 'America/Guayaquil', previous: calendar.state })
            calendar = slot
          }
          if (slot.start_time && !visitRequest) visitRequest = { request_id: 'synthetic-visit', action: 'submitted' }
          audit = { ...audit, source: 'visit_intake', action: visitRequest ? 'submitted' : 'collecting', preference: slot,
            registration_verified: !!visitRequest, request_id: visitRequest?.request_id }
        }
        let info = { ...clone(verified), catalogo: catalog, historial: history, lead: {}, perfil_lead: profile, semantica_turno: semantics,
          hechos_confirmados: summary._interpretation_memory,
          solicitudes_interpretadas: interpreted.requests, contrato_turno: intent, property_context: property.context,
          referencia_unidad: property, interaction_mode: mode, _sales_memory: summary._sales_memory,
          recorrido_comercial: summary._commercial_journey,
          estado_conversacion: { presentation_sent: summary._lead_introduction?.presentation_sent,
            brochure_sent: summary._lead_introduction?.brochure_sent } }
        if (dialogue) info.visit_dialogue_plan = dialogue
        if (reservation) info.reservation_context = projectReservationOperation({ catalog, lead: { id: 'synthetic-lead',
          assigned_to: 'synthetic-advisor', handoff_status: 'assigned' }, requests: [{ ...reservation,
          id: reservation.request_id, lead_id: 'synthetic-lead' }] })
        const introduction = leadIntroductionTurn({ current, history, summary: { ...summary, _lead_profile: profile }, extracted: interpreted.extracted,
          profile, reply: '', audit, projectInfo: info, catalog, engagement: { interaction_mode: mode } })
        audit = introduction.audit
        const plan = commercialJourneyPlan(info, audit)
        info = { ...info, siguiente_paso_comercial: plan }
        const written = await withResponseReviewPolicy(responseReviewSettings({ response_review: { enabled: false } }),
          () => completeTurnReply({ current, history, verified: info, audit, baseReply: introduction.reply }, generate))
        const receipts = object(written.audit.writer_receipts)
        const delivered = deliveredPendingQuestion(written.reply, { metadata: written.audit.question, plan }, catalog)
        // Match processConversation: persist the actual delivered question before
        // remembering property context, so its next answer has the same referent.
        audit.pending_question = delivered
        const savedSales = rememberSalesReply(summary._sales_memory, history, current, written.reply,
          { semantics, intent, scope: intent.scope, pendingQuestion: summary._pending_question },
          { writerReceipts: receipts, pendingQuestion: delivered })
        const savedJourney = rememberCommercialJourney(object(summary._commercial_journey), plan, delivered,
          object(written.audit.follow_up).usable === true, receipts.presented_unit_ids || [])
        summary = { ...rememberInterpretedTurn(summary, current, interpreted.extracted, semantics), _interaction_mode: mode,
          _lead_profile: profile, _turn_intent: intent, _sales_memory: savedSales, _commercial_journey: savedJourney,
          _property_context: rememberPropertyReply(catalog, property.context, written.reply, { ...audit, turn_completeness: written.audit }) }
        summary._lead_introduction = rememberLeadIntroduction({ previous: summary._lead_introduction, planned: introduction.state,
          profile, reply: written.reply, audit: { ...audit, turn_completeness: written.audit }, accepted: true,
          followUpUsable: object(written.audit.follow_up).usable === true })
        summary._pending_question = delivered
        if (dialogue) visitState = rememberVisitDialogue(visitState, dialogue, visitRequest || { action: 'collecting' }, true)
        record.turns.push({ current, reply: written.reply, mode: mode.mode, profile, profile_decision: audit.profile_collection_decision || {},
          selected: object(summary._property_context).selected_ids || [], property_context: clone(summary._property_context),
          semantics: clone(semantics), scope: scopeDecision, introduction: clone(audit.profile_introduction || {}),
          raw_interpretations: clone(currentExtractions), interpretation_diagnostic: clone(interpreted.diagnostic),
          saved_introduction: clone(summary._lead_introduction || {}), requests: interpreted.requests, plan, receipts,
          reservation_authorized: reservationAuthorized,
          writer_facts: object(lastWriterContext.contexto_verificado).instalaciones || [], question: written.audit.question,
          ...(fixture.id === 'residence-and-bedroom-scope' ? { writer_contract: clone(lastWriterContext.contrato_redaccion), writer_evidence: clone(lastWriterContext.evidencia_turno) } : {}),
          ...(dialogue ? { visit_preference: slot, visit_registered: !!visitRequest } : {}) })
        history.push(...messages.map((content, i) => ({ role: 'cliente', content, external_message_id: sourceId + '-' + i })),
          { role: 'bot', content: written.reply, tool_calls: { writer_receipts: receipts } })
        save()
        console.log(JSON.stringify({ case: fixture.id, turn: index + 1, mode: mode.mode, reply: written.reply }))
      }
      fixture.check(record.turns)
      record.status = 'passed'
    } catch (error) { record.status = 'failed'; record.error = error.message; record.issues = error.issues;
      record.lastExtraction = lastExtraction; console.log(JSON.stringify({ case: fixture.id, error: error.message, issues: error.issues })) }
    save()
  }
  console.log(JSON.stringify({ cases: results.map(r => ({ id: r.id, status: r.status })), calls: requests.length, estimatedUsd: cost(measurements) }))
  process.exitCode = results.every(r => r.status === 'passed') ? 0 : 1
}
run().catch(error => { save(); console.error(error.message); process.exitCode = 1 }).finally(() => { global.fetch = realFetch })
