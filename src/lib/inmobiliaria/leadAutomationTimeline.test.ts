import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAutomationTimeline, automationEventDetails } from './leadAutomation'
import type { LeadAutomationDetail } from '@/types/leadAutomation'

function fixture(): Omit<LeadAutomationDetail, 'timeline'> {
  return { row: { lead_id: 'lead' }, messages: [], scoreEvents: [], temperatureHistory: [], stageHistory: [],
    visits: [], units: [], conversations: [], nutritionJobs: [], escalations: [] } as unknown as Omit<LeadAutomationDetail, 'timeline'>
}
const at = '2026-10-15T22:33:00Z'

test('one stored score event produces one translated item with its recorded delta and meaning', () => {
  const data = fixture()
  data.scoreEvents = [
    { id: 'a', lead_id: 'lead', event_type: 'first_response', points: 5, reason: 'respondio el primer mensaje', source_message_id: 'external', created_at: at },
    { id: 'b', lead_id: 'lead', event_type: 'asked_delivery_date', points: 17, reason: 'historical configured amount', source_message_id: null, created_at: at },
  ]
  data.messages = [{ id: 'message', external_message_id: 'external', conversation_id: 'conv', role: 'cliente', content: 'Hola', sent_at: at, media_url: null }]
  const items = buildAutomationTimeline(data)
  const scores = items.filter(item => item.eventType)
  assert.equal(scores.length, 2)
  assert.equal(items.filter(item => item.kind === 'evento_detectado').length, 0)
  assert.equal(scores[0].title, 'Participación del lead')
  assert.equal(scores[0].points, 5)
  assert.equal(scores[0].messageId, 'message')
  assert.equal(scores[1].points, 17, 'Historical points must never be replaced by current rule weights.')
  assert.equal(scores[1].messageId, undefined, 'No same-minute attribution is invented.')
})

test('duplicate IDs are deduplicated but distinct events in the same minute retain their own points', () => {
  const data = fixture()
  const event = { id: 'a', lead_id: 'lead', event_type: 'requested_visit', points: 40, reason: 'solicito visita', source_message_id: null, created_at: at }
  data.scoreEvents = [event, event, { ...event, id: 'b' }]
  const items = buildAutomationTimeline(data)
  assert.equal(items.length, 2)
  assert.ok(items.every(item => item.points === 40))
})

test('temperature uses its stored score without inventing totals or merging unrelated simultaneous records', () => {
  const data = fixture()
  data.temperatureHistory = [{ id: 't', lead_id: 'lead', from_temperature: 'tibio', to_temperature: 'caliente', score: 70, reason: 'Señales acumuladas', created_at: at }]
  data.messages = [{ id: 'bot', conversation_id: 'conv', role: 'bot', content: 'Le ayudo con su consulta.', sent_at: at, media_url: null }]
  const items = buildAutomationTimeline(data)
  assert.equal(items.find(item => item.kind === 'cambio_temperatura')?.score, 70)
  assert.match(items.find(item => item.kind === 'cambio_temperatura')!.detail!, /Tibio → Caliente/)
  assert.equal(items.find(item => item.kind === 'respuesta_bot')?.messageId, 'bot')
  assert.equal(automationEventDetails('new_unknown_signal').title, 'Señal comercial registrada')
})

test('failed or merely prepared bot drafts do not appear as responses in the timeline', () => {
  const data = fixture()
  data.messages = ['not_sent', 'prepared', 'unknown', 'sent'].map((status, index) => ({ id: String(index), conversation_id: 'conv', role: 'bot',
    content: 'Respuesta', media_url: null, sent_at: at, provider_status: status }))
  assert.deepEqual(buildAutomationTimeline(data).filter(item => item.kind === 'respuesta_bot').map(item => item.messageId), ['3'])
})
