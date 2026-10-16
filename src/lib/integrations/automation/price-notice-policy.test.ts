import { writerFixture } from './fixtures/writer-response.fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import { unitPriceQuote, PRICE_REPLY_RULES } from './price-reply'
import { reviewObligations } from './focused-review'
import { SEMANTIC_POLICY_REVIEW_RULES } from './semantic-policy-review'
import { businessRiskReviewInstructions } from './business-risk-review'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { REFERENTIAL_PRICE_NOTICE } from './price-conditions'
import { object, type Row } from './data'

const catalog = [
  { id: '602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000, is_published: true, status: 'disponible' },
  { id: '605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 539900, is_published: true, status: 'disponible' },
]
const policy = (enabled: boolean) => ({ precios_autorizados: true, precios_aproximados: true, aviso_precios_referenciales: enabled })

for (const enabled of [false, true]) for (const current of ['¿Qué precio tiene el penthouse 602?', '¿Qué precios tienen los penthouses de tres dormitorios?'])
  test(`quotes and review obligations share the notice setting (${enabled}, ${current})`, () => {
    const info = { alcance_negocio: 'property', catalogo: catalog, politica_comercial: policy(enabled) }
    const quote = unitPriceQuote(info, current, {})!
    assert.equal(quote.quoted, true)
    assert.ok(quote.prices?.includes(550000), 'Disabling the notice does not hide or change the quoted price.')
    assert.equal(/pueden cambiar|sujet[oa]s? a cambios|pueden variar/.test(quote.reply), enabled)
    assert.doesNotMatch(quote.reply, /precio fijo|garantizado/)
    const obligations = reviewObligations({}, info, {})
    assert.equal(obligations.some(row => row.id === 'price_conditions'), enabled)
    assert.equal(obligations.some(row => row.id === 'price_notice_disabled'), !enabled)
  })

test('a notice in a registered prior bot reply is not repeated in the next price reply or demanded by the reviewer', async () => {
  const reply = 'El penthouse 602 cuesta $550,000.', tasks: string[] = []
  const result = await completeTurnReply({ current: '¿Qué precio tiene el penthouse 602?', baseReply: reply,
    history: [{ id: 'previous-reply', role: 'bot', content: 'Los departamentos cuestan desde $250.000. Son precios referenciales y pueden cambiar.' }],
    verified: { politica_comercial: policy(true), catalogo: catalog,
      price_notice_receipt: { version: 'price-notice-v1', shared: true, source: 'accepted_bot_reply', source_message_id: 'previous-reply' } },
    audit: { source: 'unit_price', semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); tasks.push(task!)
    const obligations = input.obligaciones_del_turno as Row[]
    assert.equal(obligations.some(row => row.id === 'price_conditions'), false)
    assert.equal(obligations.some(row => row.id === 'price_notice_disabled'), task === 'writing')
    if (task === 'writing') return writerFixture({ reply, question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
      requests: [{ fragment: 'R1', intent: 'Informar precio', request_type: 'general_information', status: 'answered', evidence: 'Precio actual de la unidad', fact_key: null }] })
    assert.equal(String(input.borrador).includes(REFERENTIAL_PRICE_NOTICE), false)
    return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
  })
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.reply.includes(REFERENTIAL_PRICE_NOTICE), false)
  assert.ok(result.reply.includes('$550,000.'))
})

test('all prompt and reviewer paths distinguish automatic notices from explicit price-condition questions', () => {
  for (const rules of [PRICE_REPLY_RULES]) {
    assert.match(rules, /aviso_precios_referenciales=false/)
    assert.match(rules, /cliente pregunta expresamente por vigencia, cambios o condiciones/)
    assert.match(rules, /nunca deduzca que el precio es fijo/)
  }
  for (const rules of [SEMANTIC_POLICY_REVIEW_RULES, businessRiskReviewInstructions()]) {
    assert.match(rules, /No decide qué comunicar ni qué preguntar/)
    assert.match(rules, /garantía/)
  }
})

for (const enabled of [false, true]) for (const reviewEnabled of [false, true])
  test(`server preparation respects notice ${enabled} with review ${reviewEnabled}`, async () => {
    const reply = 'El penthouse 602 cuesta $550,000.'
    const tasks: string[] = []
    const result = await withResponseReviewPolicy({ enabled: reviewEnabled, updatedAt: null }, () => completeTurnReply({
      current: '¿Qué precio tiene el penthouse 602?', baseReply: reply,
      verified: { politica_comercial: policy(enabled), catalogo: catalog },
      audit: { source: 'unit_price', semantic_review_enabled: true, business_risk_review_enabled: true },
    }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
      tasks.push(task!)
      const input = object(raw)
      const obligations = input.obligaciones_del_turno as Row[]
      assert.equal(obligations.some(row => row.id === 'price_conditions'), enabled)
      if (task === 'writing') return writerFixture({ reply: reply + (enabled ? ' '+REFERENTIAL_PRICE_NOTICE : ''), question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
        requests: [{ fragment: 'R1', intent: 'Informar precio', request_type: 'general_information', status: 'answered', evidence: 'Precio actual de la unidad', fact_key: null }] })
      assert.equal(String(input.borrador).includes(REFERENTIAL_PRICE_NOTICE), enabled)
      return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
    }))
    assert.equal(result.needsAdvisor, false, JSON.stringify(result.audit))
    assert.equal(result.reply.includes(REFERENTIAL_PRICE_NOTICE), enabled)
    assert.ok(result.reply.includes('$550,000.'))
    assert.deepEqual(tasks, reviewEnabled ? ['writing', 'review'] : ['writing'])
  })
