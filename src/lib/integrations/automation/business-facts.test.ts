import { writerFixture } from './fixtures/writer-response.fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { validateBusinessFacts, availableAssistance } from './business-facts'
import { completeTurnReply } from './turn-completeness'
import { WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'
import { effectiveTurnBudget, turnBudgetAssessment } from './turn-budget'
import { financingInputs } from './financing'
import { sanitizeTraceSummary } from './trace-summary'
import { OpenAIRequestError } from './openai-request'
import { turnEvidence } from './turn-evidence'
import { FINANCING_PROCESS_RULES, financingCollectionActive } from './financing-guidance'

const budget = { status: 'maximum_total', amount: 100000, confidence: 'high', evidence: 'perdon 100000' }
const units = [{ id: 'local-1', unit_number: 'L1', category: 'local', published_commercial_price: 145000, is_published: true, status: 'disponible' },
  { id: 'suite-1', unit_number: 'S1', category: 'suite', published_commercial_price: 210000, is_published: true, status: 'disponible' }]
const fact = (kind: string, value: number, subject_id: string | null = 'local-1', statement = 'Faltan 45000 para el local.'): Row => ({
  kind, subject_id, statement, field: kind === 'lead_budget' ? 'amount' : 'published_commercial_price',
  value, upper_value: null, relation: 'eq', unit: 'USD', scope: null,
})
const facts = [fact('catalog_value', 145000, 'local-1', 'El local cuesta 145000.'),
  fact('lead_budget', 100000, null, 'Dispone de 100000.'), fact('budget_difference', 45000),
  fact('catalog_value', 210000, 'suite-1', 'La suite cuesta 210000.'), fact('budget_difference', 110000, 'suite-1', 'Faltan 110000 para la suite.')]
const verified = { catalogo: units, hechos_confirmados: { budget }, financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'] },
  politica_comercial: { precios_autorizados: true }, catalog_read: { complete: true },
  semantica_turno: { budget: { status: 'not_discussed', amount: null, confidence: 'low', evidence: '' } } }
const audit = { semantic_review_enabled: true, business_risk_review_enabled: true }
const noQuestion = { role: 'none', purpose: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const pass = { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
const reply = 'El local cuesta $145,000; respecto de sus $100,000 faltan $45,000. La suite cuesta $210,000 y la diferencia es $110,000. Podemos revisar financiamiento con Banco Pichincha o Cooperativa JEP.'

function harness(review: (context: Row, n: number) => Row, validateReviewEnvelope = true) {
  const calls: string[] = [], drafts: string[] = []
  let reviews = 0
  const ajv = new Ajv({ allErrors: true })
  const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_rules, input, schema, _image, _file, _tone, task) => {
    const context = object(input)
    calls.push(task || '')
    let result: Row
    if (task === 'writing') {
      assert.equal(object(object(context.contexto_verificado).presupuesto_del_turno).amount, 100000)
      assert.equal(object(context.capacidades_disponibles).bank_contact, false)
      result = writerFixture({ reply, question: noQuestion, requests: [{ fragment: 'R1', intent: 'Presupuesto y financiamiento',
        request_type: 'specific_fact', status: 'answered', evidence: 'Diferencias y orientación', fact_key: 'price' }] })
    } else {
      assert.equal(object(object(context.fuentes_autorizadas).presupuesto_confirmado).amount, 100000)
      drafts.push(String(context.borrador)); result = review(context, ++reviews)
    }
    assert.ok(schema)
    const validate = ajv.compile(schema)
    if (task === 'writing' || validateReviewEnvelope) assert.ok(validate(result), ajv.errorsText(validate.errors))
    return result
  }
  return { generate, calls, drafts }
}

test('recorded adjustment draft passes once with remembered budget and both derived differences', async () => {
  const mock = harness(() => pass)
  const result = await completeTurnReply({ current: 'y cuanto deberia ajustar', baseReply: reply, verified, audit }, mock.generate)
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls, ['writing', 'review'])
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.equal(object(result.audit.semantic_review).authority, 'ai_reviewer')
  assert.equal(object(result.audit.semantic_review).fact_checks, undefined,
    'approval must not be followed by a server numeric verdict')
  assert.ok(validateBusinessFacts(facts, units, [], budget).every(check => check.status === 'verified'),
    'the existing arithmetic diagnostic still covers both differences independently of delivery')
  const saved = sanitizeTraceSummary({ semantic_review: result.audit.semantic_review })
  assert.equal(object(saved.semantic_review).authority, 'ai_reviewer')
})

test('an obsolete numeric inventory receives one technical envelope retry on the unchanged draft', async () => {
  const mock = harness((_context, n) => n === 1 ? { ...pass, facts } : pass, false)
  const result = await completeTurnReply({ current: 'y cuanto deberia ajustar', baseReply: reply, verified, audit }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.deepEqual(mock.calls, ['writing', 'review', 'review'])
  assert.deepEqual(mock.drafts, [reply, reply])
  assert.equal(object(result.audit.semantic_review).metadata_retries, 1)
  assert.equal(object(result.audit.semantic_review).fact_checks, undefined)
  assert.deepEqual(result.audit.repair_attempts, [], 'technical envelope repair never rewrites the writer draft')
})

test('unsupported diagnostic calculations cannot override an AI approval', async () => {
  const mock = harness(() => ({ ...pass }))
  const result = await completeTurnReply({ current: 'y cuanto deberia ajustar', baseReply: reply, verified, audit }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(object(result.audit.semantic_review).authority, 'ai_reviewer')
  assert.equal(object(result.audit.semantic_review).fact_checks, undefined)
  assert.equal(validateBusinessFacts([fact('other_calculation', 45000)], units, [], budget)[0].status, 'unverified')
  assert.deepEqual(mock.calls, ['writing', 'review'])
})

test('an AI approval never starts a separate numeric extraction repair that could time out', async () => {
  const mock = harness((_context, n) => {
    if (n === 2) throw new OpenAIRequestError(0, true, 2, '', 'timeout')
    return { ...pass }
  })
  const result = await completeTurnReply({ current: 'y cuanto deberia ajustar', baseReply: reply, verified, audit }, mock.generate)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, reply)
  assert.equal(object(result.audit.semantic_review).fact_checks, undefined)
  assert.deepEqual(result.audit.repair_attempts, [])
  assert.deepEqual(mock.calls, ['writing', 'review'])
})

test('structured checks reject wrong values even if that amount belongs to another unit', () => {
  assert.equal(validateBusinessFacts([fact('catalog_value', 210000)], units, [], budget)[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([fact('budget_difference', 44000)], units, [], budget)[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([fact('lead_budget', 100, null)], units, [], budget)[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([fact('catalog_value', 145000, 'unknown')], units, [], budget)[0].status, 'unverified')
  assert.equal(validateBusinessFacts([fact('budget_difference', 45000)], units, [], { ...budget, status: 'initial_capital' })[0].status, 'unverified')
})

test('ranges and strict comparisons retain their meaning including the published minimum', () => {
  const group = { id: 'group:local:range', aggregation: 'range', published_commercial_price: 145000,
    upper_values: { published_commercial_price: 210000 } }
  const range = { ...fact('catalog_value', 145000, group.id), relation: 'range', upper_value: 210000 }
  assert.equal(validateBusinessFacts([range], units, [group], budget)[0].status, 'verified')
  assert.equal(validateBusinessFacts([{ ...range, relation: 'gt', upper_value: null }], units, [group], budget)[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([{ ...range, relation: 'gte', upper_value: null }], units, [group], budget)[0].status, 'verified')
})

test('affordable subset ranges validate against their own members while global and wrong prices still contradict', async () => {
  const catalog = [145000, 195000, 535000].map((price, index) => ({ ...units[0],
    id: `local-${index}`, unit_number: `L${index}`, published_commercial_price: price }))
  const context = { ...verified, catalogo: catalog, hechos_confirmados: { budget: { ...budget, amount: 200000 } } }
  const assessment = turnBudgetAssessment(context, {})
  const evidence = turnEvidence({ ...context, presupuesto_del_turno: assessment })
  const subsetId = 'group:budget_matching:local:range'
  const subset = evidence.groups.find(group => group.id === subsetId)!
  assert.deepEqual(subset.member_ids, ['local-0', 'local-1'])
  const range = { ...fact('catalog_value', 145000, subsetId, 'Dentro de su presupuesto hay locales de 145000 a 195000.'),
    relation: 'range', upper_value: 195000 }
  assert.equal(validateBusinessFacts([range], evidence.units, evidence.groups, budget)[0].status, 'verified')
  assert.equal(validateBusinessFacts([{ ...range, subject_id: 'group:local:all:range' }], evidence.units, evidence.groups, budget)[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([{ ...range, upper_value: 190000 }], evidence.units, evidence.groups, budget)[0].status, 'contradiction')
  const tasks: string[] = []
  const draft = 'Dentro de su presupuesto hay locales disponibles en catálogo de $145,000 a $195,000; son precios referenciales de lanzamiento y pueden variar.'
  const result = await completeTurnReply({ current: '¿Qué locales me alcanzan?', baseReply: draft, verified: context, audit },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      tasks.push(task || '')
      if (task === 'writing') return writerFixture({ reply: draft, question: noQuestion,
        requests: [{ fragment: 'R1', intent: 'Locales dentro del presupuesto', request_type: 'specific_fact', status: 'answered', evidence: draft, fact_key: 'price' }] })
      const sources = object(object(raw).fuentes_autorizadas)
      assert.ok((sources.grupos as Row[]).some(group => group.id === subsetId))
      return { ...pass }
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, draft)
  assert.deepEqual(tasks, ['writing', 'review'])
})

test('financing requirements reach writer and reviewer without confusing explanation and collection', async () => {
  for (const state of ['identificacion_pendiente', 'nombre_pendiente', 'cedula_pendiente', 'tipo_solicitante_pendiente',
    'estabilidad_pendiente', 'cargo_pendiente', 'ingreso_pendiente', 'ruc_pendiente']) {
    assert.equal(financingCollectionActive({ source: 'financing', state }), true)
  }
  for (const source of ['financing_question', 'financing_selection_required', 'financing']) {
    for (const state of ['', 'continuacion_pendiente', 'entidad_pendiente', 'lista_para_revision']) {
      assert.equal(financingCollectionActive({ source, state }), false)
    }
  }
  const draft = 'Con su autorización y la entidad elegida, necesitamos nombres completos, número de cédula y saber si trabaja como dependiente o independiente. La entidad decide la aprobación.'
  const calls: string[] = []
  const result = await completeTurnReply({ current: 'y que datos necesitara para hacer esta revision??', baseReply: draft,
    verified: { financiamiento: verified.financiamiento }, audit: { ...audit, source: 'financing_question' } },
    async (rules, _input, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      assert.equal(String(rules).includes(FINANCING_PROCESS_RULES.trim()), task === 'writing')
      assert.doesNotMatch(String(rules), /En recopilación de datos financieros, pida directamente/)
      if (task === 'review') return { ...pass }
      return writerFixture({ reply: draft, question: noQuestion, requests: [{ fragment: 'R1', intent: 'Requisitos de revisión interna',
        request_type: 'specific_fact', status: 'answered', evidence: draft, fact_key: null }] })
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, draft)
  assert.deepEqual(calls, ['writing', 'review'])
})

test('a new or ambiguous budget supersedes the remembered budget; no new amount preserves it', () => {
  assert.equal(effectiveTurnBudget(verified).amount, 100000)
  assert.equal(turnBudgetAssessment(verified, {})?.budget_source, 'confirmed_lead_memory')
  const changed = { ...verified, semantica_turno: { budget: { ...budget, amount: 160000, evidence: 'ahora tengo 160000' } } }
  assert.equal(effectiveTurnBudget(changed).amount, 160000)
  assert.equal(turnBudgetAssessment(changed, {})?.matching_unit_ids?.[0], 'local-1')
  assert.equal(effectiveTurnBudget({ ...verified, semantica_turno: { budget: { status: 'unknown', amount: null, evidence: 'no se cuanto', confidence: 'high' } } }).amount, null)
})

test('bank partners never imply a bank contact and ambiguous offers never authorize financial review', () => {
  assert.equal(availableAssistance(verified).bank_contact, false)
  const previous = '¿Desea que iniciemos la revisión o que le contacte un asesor?'
  const input = financingInputs({ financing_consent: true }, 'si', previous, { partners: ['Banco Pichincha'], current: {} },
    { kind: 'ambiguous_offer', reply: previous })
  assert.equal(input.consent, null)
})

test('the writer receipt owns an internal adviser offer without reviewer classification or prose rewriting', async () => {
  const offeredReply = 'Podemos ayudarle a revisar las opciones de financiamiento. ¿Desea que un asesor de nuestro equipo le ayude?'
  const tasks: string[] = []
  const result = await completeTurnReply({ current: 'Como funciona el financiamiento?', baseReply: offeredReply, verified, audit },
    async (_rules, input, _schema, _image, _file, _tone, task) => {
      tasks.push(String(task))
      if (task === 'writing') return writerFixture({ reply: offeredReply, question: noQuestion,
        writer_receipts: { offered_action: 'internal_advisor' },
        requests: [{ fragment: 'R1', intent: 'Ofrecer ayuda', request_type: 'general_information', status: 'answered', evidence: 'Ayuda financiera', fact_key: null }] })
      assert.equal(object(object(input).capacidades_disponibles).bank_contact, false)
      return { ...pass }
    })
  assert.equal(result.reply, offeredReply)
  assert.equal(result.audit.status, 'checked')
  assert.equal(object(result.audit.follow_up).usable, true)
  assert.equal(object(result.audit.writer_receipts).offered_action, 'internal_advisor')
  assert.deepEqual(tasks, ['writing', 'review'])
})

test('a confirmed false contact offer is corrected while authorized internal assistance passes', async () => {
  let writes = 0
  const good = 'Puede solicitar ayuda de un asesor de nuestro equipo para revisar las opciones.'
  const bad = 'Le pondré en contacto directamente con un ejecutivo bancario disponible.'
  const result = await completeTurnReply({ current: 'Ayudeme con el financiamiento', baseReply: good, verified, audit },
    async (_rules, input, _schema, _image, _file, _tone, task) => {
      if (task === 'writing') return writerFixture({ reply: ++writes === 1 ? bad : good, question: noQuestion,
        requests: [{ fragment: 'R1', intent: 'Ayuda financiera', request_type: 'general_information', status: 'answered', evidence: 'Oferta', fact_key: null }] })
      assert.equal(object(object(input).capacidades_disponibles).bank_contact, false)
      return { ...pass, verdict: writes === 1 ? 'block' : 'pass', findings: writes === 1 ? [{
        category: 'business_guardrail', statement: bad, reason: 'Ofrece una capacidad externa que no está disponible.',
        authoritative_fact: 'Solo está disponible la derivación al equipo interno; bank_contact=false.',
      }] : [] }
    })
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.reply, good)
  assert.equal(writes, 2)
})

test('material rejection rewrites directly even when its numeric metadata also needs repair', async () => {
  const calls: string[] = []
  let writes = 0
  const good = 'El local cuesta $145,000.'
  const bad = 'El local cuesta $100,000.'
  const result = await completeTurnReply({ current: '¿Cuánto cuesta el local?', baseReply: bad, verified, audit },
    async (_rules, _input, _schema, _image, _file, _tone, task) => {
      calls.push(String(task))
      if (task === 'writing') return writerFixture({ reply: ++writes === 1 ? bad : good, question: noQuestion,
        requests: [{ fragment: 'R1', intent: 'Precio del local', request_type: 'specific_fact', status: 'answered', evidence: 'Precio publicado', fact_key: 'price' }] })
      return writes === 1 ? { ...pass, verdict: 'block', findings: [{ category: 'hard_fact', statement: bad, reason: 'Precio incorrecto.', authoritative_fact: '145000' }] }
        : { ...pass }
    })
  assert.equal(result.reply,good)
  assert.equal(result.audit.status,'checked',JSON.stringify(result.audit))
  assert.deepEqual(calls,['writing','review','writing','review'])
})
