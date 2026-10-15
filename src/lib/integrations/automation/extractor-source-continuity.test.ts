import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { formattedEvidenceQuote, reconcileInformationalEvidence, currentMessageFragments } from './current-evidence-fragments'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { resolvePropertyTurn } from './property-context'
import { deliveredPendingQuestion } from './continuation-question'
import { commercialJourneyPlan, commercialSelectionQuery } from './commercial-journey'
import { financingStage } from './financing-stage'
import { rememberFinancingEntry } from './financing-entry'
import { leadBudget } from './budget-state'
import { writerObjectiveContext } from './writer-objectives'
import { LEAD_INTRODUCTION_RULES } from './lead-introduction'
import { generationRecoveryNotice } from './conversation-language'
import { changePoolAccess, poolAccessContext } from '@/lib/inmobiliaria/poolAccess'
import { taskVerifiedContext } from './task-context'
import { verifiedClaimSources } from './turn-evidence'
import { aiJson } from './ai'
import { DEFAULT_TONE } from '@/lib/inmobiliaria/conversationTone'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 2, area_internal_m2: 120.83, published_commercial_price: 250000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, bathrooms_full: 2, floor_number: 6, area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, bathrooms_full: 3, floor_number: 6, area_internal_m2: 140.53, published_commercial_price: 539900 },
]
const budget = { status: 'maximum_total', amount: 500000, confidence: 'high', evidence: 'Tengo unos 500 mil para la compra' }
function info(): Row { return { catalogo: catalog, catalogo_verificacion: catalog, catalog_verification_read: { complete: true }, catalog_read: { complete: true },
  lead: { purchase_purpose: 'invertir' }, politica_comercial: { precios_autorizados: true },
  hechos_confirmados: { budget, property: { category: 'penthouse', group: 'residential', filters: { bedrooms: 3 }, evidence: 'Prefiero un penthouse de tres dormitorios', confidence: 'high' } },
  property_context: { query: { category: 'penthouse', group: 'residential', operation: 'none', scope: 'catalog', filters: { bedrooms: null } }, selected_ids: [] },
  financiamiento: { partners: ['Cooperativa JEP'], journey: {}, current: {} } } }
function selection(current: string, quote = current): Row { return {
  requests: [{ domain: 'property', request: 'Elegir la opción con más baños', evidence: current, confidence: 'high' }],
  turn_semantics: { primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', category: 'penthouse', operation: 'select', reference_kind: 'relative',
      unit_numbers: ['605'], query_scope: 'comparison', filters: {}, evidence: quote, confidence: 'high' } } } }

for (const [name, current, quote] of [
  ['literal', 'El de tres baños', 'El de tres baños'],
  ['CRLF', 'Prefiero penthouse\r\nEl de tres baños', 'Prefiero penthouse\nEl de tres baños'],
  ['línea vacía', 'Prefiero penthouse\n\nEl de tres baños', 'Prefiero penthouse\nEl de tres baños'],
  ['comillas añadidas', 'El de tres baños', '«El de tres baños»'],
  ['espacio especial', 'El de tres\u00a0baños', 'El de tres baños'],
  ['Unicode equivalente', 'El de tres ban\u0303os', 'El de tres baños'],
  ['inglés', 'The one with three bathrooms', '“The one with three bathrooms”'],
]) test('selection citation survives formatting: ' + name, async () => {
  const proposed = selection(current, quote), before = structuredClone(proposed)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '', aiJson: async () => { calls++; return proposed } })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.property).operation, 'select')
  assert.deepEqual(object(result.semantics.property).unit_numbers, ['605'])
  assert.deepEqual(proposed, before)
})

for (const middle of ['Me interesa por la amplitud', '👍', '[Sticker recibido]', 'Soy jubilada de Estados Unidos'])
  test('a split relative choice repairs only the source and keeps PH605: ' + middle, async () => {
    const current = 'Prefiero penthouse\n' + middle + '\nEl que tiene un baño extra'
    const readable = current.replace('[Sticker recibido]', '').trim()
    const quote = 'Prefiero penthouse\nEl que tiene un baño extra', initial = selection(readable, quote)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '', aiJson: async (_rules, input) => {
      if (++calls === 1) return initial
      assert.ok(object(input).interpretacion_propuesta)
      assert.deepEqual(object(input).mensajes_actuales, currentMessageFragments(current.replace('[Sticker recibido]', '').trim()))
      return { ...initial, evidence_sources: [{ field: 'property', fragment_ids: currentMessageFragments(current.replace('[Sticker recibido]', '').trim()).map(fragment => fragment.id) }] }
    } })
    assert.equal(calls, middle === '[Sticker recibido]' ? 1 : 2)
    assert.deepEqual(object(result.semantics.property).unit_numbers, ['605'])
    assert.equal(object(result.semantics.property).operation, 'select')
  })

test('source IDs cannot skip a negation, reverse order, reference history or grant a permission', () => {
  const current = 'Prefiero el 605\nNo lo elijo todavía\nQuiero conocer sus condiciones'
  const original = selection(current, 'Prefiero el 605\nQuiero conocer sus condiciones')
  for (const fragment_ids of [['current:1', 'current:3'], ['current:3', 'current:1'], ['history:1'], ['current:99']]) {
    const raw = { ...original, evidence_sources: [{ field: 'property', fragment_ids }] }
    assert.equal(object(object(reconcileInformationalEvidence(raw, current).turn_semantics).property).evidence, object(object(original.turn_semantics).property).evidence)
  }
  const raw = { ...original, financing_consent: null, action_evidence: { requested_advisor: '' }, evidence_sources: [
    { field: 'financing_consent', fragment_ids: ['current:1'] }, { field: 'action_evidence.requested_advisor', fragment_ids: ['current:1'] } ] }
  const fixed = reconcileInformationalEvidence(raw, current)
  assert.equal(fixed.financing_consent, null)
  assert.equal(object(fixed.action_evidence).requested_advisor, '')
})

test('a later correction can revise the proposal instead of preserving an obsolete selection', async () => {
  const current = 'El 602\nPerdón, el 605, el de tres baños', raw = selection(current, 'Una cita que no existe')
  object(object(raw.turn_semantics).property).unit_numbers = ['602']
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '', aiJson: async () => {
    if (++calls === 1) return raw
    return selection(current)
  } })
  assert.deepEqual(object(result.semantics.property).unit_numbers, ['605'])
})

test('a certified model recheck can restore a split selection even without source IDs', async () => {
  const current = 'Prefiero penthouse\nCreo que se ajusta a lo que busco\nEl de tres baños', quote = 'Prefiero penthouse\nEl de tres baños'
  let calls = 0
  const turn = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '', aiJson: async () => {
    calls++
    return { ...selection(current, quote), ...(calls === 2 ? { recovery_outcome: 'repaired' } : {}) }
  } })
  assert.equal(calls, 2)
  assert.equal(object(turn.semantics.property).evidence, current)
  assert.deepEqual(object(turn.semantics.property).unit_numbers, ['605'])
})

test('an unrepairable property citation asks a targeted clarification and preserves valid facts', async () => {
  const current = 'El de tres, y quiero saber si tiene bodega', raw = selection(current, 'Una selección del historial')
  let calls = 0
  const turn = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => '', aiJson: async () => { calls++; return calls === 1 ? raw : { ...raw, recovery_outcome: 'clarification' } } })
  assert.equal(calls, 2)
  assert.equal(turn.diagnostic.interpretation_recovery && object(turn.diagnostic.interpretation_recovery).status, 'partial')
  assert.notEqual(object(turn.semantics.property).operation, 'select')
  assert.equal(commercialJourneyPlan({ ...info(), semantica_turno: turn.semantics }).action, 'clarify_interpretation')
})

test('nonliteral, reordered and ambiguous quotations are never silently fabricated', () => {
  const current = 'Prefiero amplitud\nTodavía no elijo\nEl de tres baños'
  for (const quote of ['El de tres baños\nPrefiero amplitud', 'Prefiero el 605', '«Una frase ajena»'])
    assert.equal(formattedEvidenceQuote(quote, current), quote)
})

test('a remembered bedroom need is authoritative for discovery as well as searching', () => {
  const verified = info()
  assert.equal(commercialSelectionQuery(verified).filters.bedrooms, 3)
  assert.notEqual(commercialJourneyPlan(verified).action, 'discover_bedrooms')
})

test('a second pool question defers housing capture without losing the actual question or its purpose', () => {
  const verified = info()
  verified.hechos_confirmados = { budget }
  verified.property_context = { query: { filters: {} }, pending_question: { id: 'property_category', act: 'choose_category',
    question: '¿Le gustaría una vivienda o un espacio comercial?' } }
  verified.solicitudes_interpretadas = [{ domain: 'property', request: '¿Cómo confirmo si mis huéspedes pueden usar la piscina?',
    evidence: 'piscina', confidence: 'high', topics: ['common_area_access'] }]
  const plan = commercialJourneyPlan(verified)
  assert.equal(plan.action, 'answer_current_question')
  assert.equal(plan.question, '')
  assert.equal(object(plan.deferred_question).act, 'choose_category')
  assert.equal(object(plan.deferred_question).question, '¿Le gustaría una vivienda o un espacio comercial?')
})

test('undefined entry preserves total budget, PH605, lender and the next financial step', async () => {
  const current = 'Mmm bueno aún no tengo decidido', pending = { id: 'financing_down_payment', act: 'financing' }
  const raw: Row = { requests: [], turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: pending.id, kind: 'uncertain', evidence: current, confidence: 'high' },
    budget: { status: 'no_defined_budget', amount: null, evidence: current, confidence: 'high' } } }
  const interpreted = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, { activePrompt: async () => '', aiJson: async () => raw })
  const remembered = rememberInterpretedTurn({ _interpretation_memory: { budget } }, current, interpreted.extracted, interpreted.semantics)
  assert.equal(object(object(remembered._interpretation_memory).budget).amount, 500000)
  const entry = rememberFinancingEntry({}, current, { ...interpreted.extracted, turn_semantics: interpreted.semantics }, pending, 'entry-answer')
  assert.equal(entry.status, 'not_defined')
  const verified = info()
  verified.semantica_turno = interpreted.semantics
  object(verified.property_context).selected_ids = ['p605']
  verified.financiamiento = { partners: ['Cooperativa JEP'], current: {}, entry, journey: { accepted: true,
    partner_preference: { name: 'Cooperativa JEP', evidence: 'Entonces la JEP', source_message_id: 'lender-answer' } } }
  assert.equal(leadBudget(verified).amount, 500000)
  const stage = financingStage(verified)
  assert.equal(stage.stage, 'continue_financing')
  assert.equal(stage.collection_allowed, true)
  assert.equal(stage.selected_partner_preference, 'Cooperativa JEP')
  assert.equal(stage.selected_unit_number, '605')
})

test('an accepted cross-category comparison keeps both sides and never selects one', () => {
  const reply = '¿Le gustaría comparar los departamentos con estos penthouses de tres dormitorios?'
  const pending = deliveredPendingQuestion(reply, { metadata: { text: reply, purpose: 'choose_property', continuation_id: 'property_comparison',
    continuation_act: 'compare_properties', comparison_categories: ['departamento', 'penthouse'], comparison_bedrooms: 3 } }, catalog)
  assert.deepEqual(new Set(pending.candidate_ids as string[]), new Set(['d202', 'p602', 'p605']))
  const semantics = { primary_intent: 'answer_previous', confidence: 'high', primary_evidence: 'Sí, comparemos',
    answer_to_previous: { question_id: 'property_comparison', kind: 'affirmative', evidence: 'Sí, comparemos', confidence: 'high' } }
  const result = resolvePropertyTurn(catalog, 'Sí, comparemos', { _pending_question: pending,
    _property_context: object(info().property_context) }, [], semantics)
  assert.equal(result.needsClarification, false)
  assert.deepEqual(new Set(result.matches.map(unit => unit.category)), new Set(['departamento', 'penthouse']))
  assert.deepEqual(object(result.context).selected_ids, [])
  assert.equal(commercialJourneyPlan({ ...info(), property_context: result.context, semantica_turno: semantics }).action, 'compare_properties')
})

test('pool access is editable, retained in factual evidence and independent of other policies', () => {
  const initial = { unrelated: { keep: true }, business_policies: { items: [] } }
  for (const allowTemporaryGuests of [false, true, false]) {
    const changed = changePoolAccess(initial, { allowTemporaryGuests }, 'admin', '2026-10-15T18:00:00Z')
    assert.deepEqual(changed.unrelated, initial.unrelated)
    const access = poolAccessContext(changed)
    assert.equal(access.allowTemporaryGuests, allowTemporaryGuests)
    const verified = { ...info(), acceso_piscina: access, solicitudes_interpretadas: [{ domain: 'property', request: '¿Pueden usar la piscina mis huéspedes?', evidence: 'piscina', confidence: 'high', topics: ['common_area_access'] }] }
    assert.deepEqual(taskVerifiedContext(verified, {}, 'piscina').acceso_piscina, access)
    assert.ok(verifiedClaimSources(verified, {}, {}, '').some(source => source.id === 'contexto_verificado.acceso_piscina' || JSON.stringify(source).includes('acceso_piscina')))
  }
  assert.equal(poolAccessContext({}).allowTemporaryGuests, false)
  assert.throws(() => changePoolAccess({}, { allowTemporaryGuests: 'false' }, 'admin', 'now'))
})

test('pool migration is scoped, preserves unrelated settings and never overwrites a saved decision', async t => {
  const pg = new PGlite()
  t.after(async () => { await pg.close() })
  await pg.exec('create schema if not exists public; create table public.projects (id uuid primary key, tenant_id uuid, policies_json jsonb, updated_at timestamptz)')
  const project = 'b1b2c3d4-0001-4000-8000-000000000001', tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
  await pg.query('insert into projects values ($1,$2,$3,now()), ($4,$2,$3,now())', [project, tenant, JSON.stringify({ unrelated: true }), '00000000-0000-4000-8000-000000000002'])
  const migration = readFileSync('supabase/migrations/20261015180000_pool_temporary_guest_access.sql', 'utf8')
  await pg.exec(migration)
  const initial = await pg.query<{ policies_json: Row }>('select policies_json from projects where id=$1', [project])
  assert.equal(object(initial.rows[0].policies_json.pool_access).allowTemporaryGuests, false)
  assert.equal(initial.rows[0].policies_json.unrelated, true)
  await pg.query("update projects set policies_json=jsonb_set(policies_json,'{pool_access,allowTemporaryGuests}','true') where id=$1", [project])
  await pg.exec(migration)
  const saved = await pg.query<{ policies_json: Row }>('select policies_json from projects where id=$1', [project])
  assert.equal(object(saved.rows[0].policies_json.pool_access).allowTemporaryGuests, true)
  const other = await pg.query<{ policies_json: Row }>('select policies_json from projects where id=$1', ['00000000-0000-4000-8000-000000000002'])
  assert.deepEqual(other.rows[0].policies_json, { unrelated: true })
})

test('profile drafting exposes an objective rather than the old brochure justification', () => {
  const context = writerObjectiveContext({ estado_operativo: { profile_introduction: { question_purpose: 'collect_profile',
    question: 'Para compartirle el brochure y brindarle una guía personalizada, ¿su nombre?', missing_fields: ['full_name', 'residence'] } } })
  assert.doesNotMatch(JSON.stringify(context), /Para compartirle el brochure/)
  assert.equal(object(object(object(context.estado_operativo).profile_introduction).objetivo_conversacion).question_id, 'lead_profile')
  assert.match(String(object(object(object(context.estado_operativo).profile_introduction).objetivo_conversacion).objective), /pregunta natural/)
  assert.match(LEAD_INTRODUCTION_RULES, /no una frase que deba copiar/)
  assert.equal(generationRecoveryNotice({ tag: 'es' }), 'Permítanos revisar ese detalle con nuestro equipo para orientarle mejor.')
})

for (const failure of ['truncated', 'empty', 'invalid_json'] as const) test('extractor output recovery is bounded and keeps its schema: ' + failure, async t => {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey })
  process.env.OPENAI_API_KEY = 'local-test-key'
  const bodies: Row[] = []
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify(bodies.length === 1 && failure === 'truncated'
      ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }
      : { status: 'completed', output: [{ content: [{ type: 'output_text', text: bodies.length === 1 ? failure === 'empty' ? '' : '{invalid' : '{"turn_semantics":{}}' }] }] }), { status: 200 })
  }
  const schema = { type: 'object', additionalProperties: false, properties: { turn_semantics: { type: 'object' } }, required: ['turn_semantics'] }
  const result = await aiJson('Interprete este turno.', { mensaje_actual: 'El de tres baños' }, schema, undefined, undefined, DEFAULT_TONE)
  assert.deepEqual(result, { turn_semantics: {} })
  assert.equal(bodies.length, 2)
  assert.deepEqual(object(object(bodies[0].text).format).schema, object(object(bodies[1].text).format).schema)
  if (failure === 'truncated') assert.ok(Number(bodies[1].max_output_tokens) > Number(bodies[0].max_output_tokens))
})

test('an authentication failure is not retried as a citation or output problem', async t => {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY
  t.after(() => { globalThis.fetch = previousFetch; if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey })
  process.env.OPENAI_API_KEY = 'local-test-key'
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 }) }
  await assert.rejects(aiJson('Interprete este turno.', { mensaje_actual: 'El de tres baños' }, { properties: { turn_semantics: {} } }, undefined, undefined, DEFAULT_TONE))
  assert.equal(calls, 1)
})
