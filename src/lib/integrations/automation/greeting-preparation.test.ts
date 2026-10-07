import test from 'node:test'
import assert from 'node:assert/strict'
import { greetingForTurn, applyTurnGreeting } from './conversation-style'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'
import { withResponseReviewPolicy } from './response-review-policy'
import { BROCHURE_URL } from './project-material'
import { REFERENTIAL_PRICE_NOTICE } from './price-conditions'

const at = '2026-10-07T17:00:00Z'
const none = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const pass = { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
function candidate(reply: string) { return { reply, question: none, requests: [{ fragment: 'R1', intent: 'Atender solicitud', request_type: 'general_information', status: 'answered', evidence: 'Respuesta', fact_key: null }] } }

for (const current of ['hola', 'Quiero precios', 'Necesito visitar', 'Gracias', '[Audio recibido]', '[Archivo pendiente de revisar]', ''])
  test('the first allowed response greets independently of inbound content: '+JSON.stringify(current), () => {
    const greeting = greetingForTurn(current, [{ role: 'cliente', content: current }], null, at)
    assert.equal(greeting, 'Hola')
    assert.equal(applyTurnGreeting('Con gusto.', greeting), 'Hola. Con gusto.')
    assert.equal(applyTurnGreeting(applyTurnGreeting('Con gusto.', greeting), greeting), 'Hola. Con gusto.')
  })
for (const status of ['rejected', 'failed', 'cancelled', 'not_sent', 'pending', 'queued'])
  test('a '+status+' draft does not suppress the first actual greeting', () => {
    assert.equal(greetingForTurn('Quiero precios', [{ role: 'bot', content: 'No enviado', tool_calls: { provider_status: status } }], null, at), 'Hola')
  })
test('a previous accepted reply or advisor reply suppresses repeated consecutive greetings', () => {
  for (const role of ['bot', 'asesor']) for (const current of ['Quiero precios', 'Hola, quiero precios'])
    assert.equal(greetingForTurn(current, [{ role, content: 'Hola', sent_at: '2026-10-07T16:59:00Z', provider_status: 'accepted' }], null, at), '')
  assert.equal(greetingForTurn('Quiero precios', [], at, at), '')
})
for (const initial of ['Hola. Con gusto.', 'Buenos días. Con gusto.', 'Buenas tardes. Con gusto.', 'Buenas noches. Con gusto.'])
  test('shared greeting preparation preserves an existing opening: '+initial, () => assert.equal(applyTurnGreeting(initial, 'Hola'), initial))

for (const source of ['catalog_search', 'commercial', 'virtual_showroom', 'brochure', 'visit_information', 'financing_orientation'])
  test('reviewed '+source+' route receives the initial greeting before review', async () => {
    const tasks: string[] = []
    const result = await completeTurnReply({ current: 'Quiero información', baseReply: 'Con gusto le orientamos.', verified: {},
      audit: { source, semantic_review_enabled: true, business_risk_review_enabled: true, writer_greeting: 'Hola' } },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      tasks.push(task!)
      if (task === 'writing') return candidate('Con gusto le orientamos.')
      assert.equal(object(raw).borrador, 'Hola. Con gusto le orientamos.' + (source === 'brochure' ? '\n\nBrochure del proyecto: '+BROCHURE_URL : ''))
      return pass
    })
    assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
    assert.equal(result.reply, 'Hola. Con gusto le orientamos.' + (source === 'brochure' ? '\n\nBrochure del proyecto: '+BROCHURE_URL : ''))
    assert.deepEqual(tasks, ['writing', 'review'])
    assert.ok((result.audit.text_transformations as Row[]).some(row => row.stage === 'Saludo común antes de revisión'))
  })
for (const enabled of [true, false]) test('price conditions and greeting are prepared together with review '+enabled, async () => {
  const reply = 'Los departamentos tienen precios desde $250.000.'
  const tasks: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply({ current: 'Quiero precios', baseReply: reply,
    verified: { politica_comercial: { precios_autorizados: true, precios_aproximados: true }, catalogo: [{ id: 'd202', category: 'departamento', unit_number: '202', published_commercial_price: 250000 }] },
    audit: { semantic_review_enabled: true, business_risk_review_enabled: true, writer_greeting: 'Hola' } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    tasks.push(task!)
    if (task === 'writing') return candidate(reply)
    assert.ok(String(object(raw).borrador).startsWith('Hola.'))
    assert.ok(String(object(raw).borrador).includes(REFERENTIAL_PRICE_NOTICE))
    return pass
  }))
  assert.ok(result.reply.startsWith('Hola.'))
  assert.ok(result.reply.includes(REFERENTIAL_PRICE_NOTICE))
  assert.deepEqual(tasks, enabled ? ['writing', 'review'] : ['writing'])
})

test('general 360 references are an explicit shared writer and reviewer obligation', async () => {
  const result = await completeTurnReply({ current: '¿Cómo puedo ver el departamento?', baseReply: 'Aquí puede explorar las opciones del proyecto.', verified: { property_context: { selected_ids: [] } },
    audit: { source: 'virtual_showroom', unit_model: { unit_id: null }, semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    assert.ok((object(raw).obligaciones_del_turno as Row[]).some(row => row.id === 'general_visualization_reference'))
    return task === 'writing' ? candidate('Aquí puede explorar las opciones del proyecto.') : pass
  })
  assert.equal(result.audit.status, 'checked')
})
