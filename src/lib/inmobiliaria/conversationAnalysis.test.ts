import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analysisCsv, buildConversationAnalysisCase, filterAnalysisCases, type AnalysisCaseInput } from './conversationAnalysis'
import { normalizeAnalysisAssessment } from '@/lib/integrations/automation/conversation-analysis-contract'

const asOf = '2026-10-16T18:00:00Z'
function fixture(extra: Partial<AnalysisCaseInput> = {}) {
  return buildConversationAnalysisCase({
    lead: { id: 'lead-1', tenant_id: 'tenant-1', project_id: 'project-1', name: 'María', created_at: '2026-10-01T12:00:00Z', bot_enabled: true, handoff_status: 'none', temperature: 'frio' },
    conversations: [{ id: 'c1', lead_id: 'lead-1', started_at: '2026-10-01T12:00:00Z', last_message_at: '2026-10-16T17:00:00Z', summary: {} }],
    messages: [{ id: 'm1', conversation_id: 'c1', role: 'cliente', content: 'Quiero conocer el proyecto', sent_at: '2026-10-16T17:00:00Z' }],
    coverage: { messages: true, conversations: true, events: true, appointments: true, reservations: true, sales: true, whatsapp_evidence: true }, asOf, ...extra,
  })
}
test('inactivity, cold temperature and a WhatsApp opt-out never establish a lost sale', () => {
  const item = fixture({ lead: { id: 'lead-1', created_at: '2026-10-01', temperature: 'frio', tracking_opt_out_at: asOf } })
  assert.equal(item.lost, false); assert.equal(item.contactStopped, true); assert.equal(item.signals.length, 0)
})
test('a missing synchronization source is not reported as a proven unattended message', () => {
  const item = fixture({ coverage: { messages: true, whatsapp_evidence: false } })
  assert.equal(item.waiting, 'unknown'); assert.equal(item.signals.some(s => s.key.startsWith('unanswered:')), false)
})
test('a pending reservation is urgent before 24h and never becomes reserved inventory or a lost opportunity', () => {
  const item = fixture({ reservations: [{ id: 'r1', lead_id: 'lead-1', unit_ids: ['u1'], evidence: 'Quiero reservar', source_message_id: 'm1', created_at: '2026-10-16T17:00:00Z', notification_status: 'pending_assignment' }] })
  assert.equal(item.moment, 'reservation'); assert.equal(item.stage, 'proceso_reserva'); assert.equal(item.lost, false)
  assert.ok(item.signals.some(s => s.key === 'reservation_unassigned:r1' && s.priority === 'high'))
})
test('advisor response evidence stops an expired handoff from becoming an unattended deadline', () => {
  const item = fixture({ lead: { id: 'lead-1', handoff_status: 'assigned', handoff_requested_at: '2026-10-16T16:00:00Z', seller_response_due_at: '2026-10-16T17:00:00Z', seller_first_response_at: '2026-10-16T16:30:00Z' } })
  assert.equal(item.signals.some(s => s.key === 'advisor_overdue'), false)
})
test('cancelled pre-send incidents are visible, while a later recorded answer resolves that pre-send incident', () => {
  const incident = { id: 'e1', status: 'cancelled', received_at: '2026-10-16T17:00:00Z', result: { requires_review: true, reason: 'TURN_INTERPRETATION_INVALID', delivery_status: 'not_sent' } }
  assert.ok(fixture({ incidents: [incident] }).signals.some(s => s.key === 'incident:e1'))
  const item = fixture({ incidents: [incident], messages: [{ id: 'b1', role: 'bot', sent_at: '2026-10-16T17:10:00Z', tool_calls: { provider_status: 'accepted' } }] })
  assert.equal(item.signals.some(s => s.key === 'incident:e1'), false)
})
test('uncertain operations remain visible after a later answer and after a human resolves a review note', () => {
  const item = fixture({ incidents: [{ id: 'e2', status: 'uncertain', received_at: '2026-10-16T16:00:00Z', result: { requires_review: true } }],
    reviews: [{ id: 'review', status: 'resolved', note: 'Se revisó el caso con el equipo', created_at: '2026-10-16T16:30:00Z' }] })
  assert.ok(item.signals.some(s => s.key === 'incident:e2'))
})
test('an assessment of an earlier conversation cannot explain the latest conversation', () => {
  const item = fixture({ analyses: [{ id: 'old', conversation_id: 'other', created_at: asOf, analysis: { version: 2, summary: 'Otra conversación' } }] })
  assert.equal(item.analysis, null)
})
test('legacy assessments remain readable but are explicitly stale', () => {
  const item = fixture({ analyses: [{ id: 'old', conversation_id: 'c1', created_at: asOf, source_last_message_at: asOf, analysis: { version: 1, summary: 'Histórico' } }] })
  assert.equal(item.stale, true); assert.equal(item.analysis?.summary, 'Histórico')
})
test('a future purchase with a contact agreement is a legitimate planned wait', () => {
  const item = fixture({ metadata: { nutrition_active: true, nutrition_reason: 'Compra el próximo año', nutrition_evidence: 'Busco el próximo año', purchase_horizon: 'el próximo año', contact_consent: true, updated_at: asOf } })
  assert.equal(item.waiting, 'planned'); assert.equal(item.futureInterest, true); assert.equal(item.lost, false)
})
test('a human resolution alone never creates a measured recovery', () => {
  const reviews = [{ id: 'r1', status: 'resolved', created_at: '2026-10-16T17:30:00Z', note: 'Consulta atendida por el equipo' }]
  assert.equal(fixture({ reviews }).recovery, null)
  assert.ok(fixture({ reviews, messages: [{ id: 'return', role: 'cliente', sent_at: '2026-10-16T17:45:00Z' }] }).recovery)
})
test('the cohort uses Ecuador day boundaries and supports accent-insensitive advisor/name searches', () => {
  const item = fixture({ lead: { id: 'lead-1', name: 'María', created_at: '2026-10-02T02:00:00Z' } })
  assert.equal(filterAnalysisCases([item], { from: '2026-10-01', to: '2026-10-01', query: 'maria' }).length, 1)
  assert.equal(filterAnalysisCases([item], { from: '2026-10-02' }).length, 0)
})
test('CSV cells cannot execute spreadsheet formulas, and quotes/newlines stay inside their cells', () => {
  const item = fixture(); item.name = '=HYPERLINK("unsafe")'; item.nextStep = 'Primera línea\nSegunda, con coma'
  const csv = analysisCsv([item])
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"')); assert.ok(csv.includes('"Primera línea\nSegunda, con coma"'))
})
test('earlier customer evidence survives a later thank-you and several independent factors coexist', () => {
  const history = [{ id: 'm1', role: 'cliente', content: 'Se sale de mi presupuesto' }, { id: 'm2', role: 'cliente', content: 'Gracias' }, { id: 'b1', role: 'bot', content: '¿Qué presupuesto tiene?' }]
  const result = normalizeAnalysisAssessment({ factors: [
    { kind: 'customer', reason: 'price', basis: 'explicit', explanation: 'Objeción de precio', evidence: [{ message_id: 'm1', quote: 'Se sale de mi presupuesto' }] },
    { kind: 'conversation', reason: 'repetition', basis: 'hypothesis', explanation: 'Revisar continuidad', evidence: [{ message_id: 'b1', quote: '¿Qué presupuesto tiene?' }] },
  ] }, history)
  assert.equal(result.factors.length, 2); assert.equal(result.factors[0].basis, 'explicit')
})
test('fabricated quotes and bot statements cannot become explicit customer reasons', () => {
  const result = normalizeAnalysisAssessment({ customer_position: { kind: 'declined', evidence: [{ message_id: 'b1', quote: 'Es caro' }] }, factors: [
    { kind: 'customer', reason: 'price', basis: 'explicit', evidence: [{ message_id: 'b1', quote: 'Es caro' }] },
    { kind: 'conversation', reason: 'context_loss', basis: 'explicit', evidence: [{ message_id: 'm1', quote: 'Nunca dicho' }] },
  ] }, [{ id: 'b1', role: 'bot', content: 'Es caro' }, { id: 'm1', role: 'cliente', content: 'Hola' }])
  assert.equal(result.factors.length, 0); assert.equal(result.customer_position.kind, 'unknown')
})
test('accepted Salesbot is a registered reply, but cannot prove delivery, customer waiting or measured response latency', () => {
  const item = fixture({ messages: [{ id: 'm1', role: 'cliente', sent_at: '2026-10-16T17:00:00Z' }, { id: 'b1', role: 'bot', sent_at: '2026-10-16T17:02:00Z', tool_calls: { provider_status: 'accepted' } }] })
  assert.ok(item.milestones.includes('response')); assert.equal(item.firstResponseSeconds, null); assert.equal(item.waiting, 'unknown')
})
test('verified send measures response latency without turning a price inquiry into a declared need', () => {
  const item = fixture({ messages: [{ id: 'm1', role: 'cliente', sent_at: '2026-10-16T17:00:00Z' }, { id: 'b1', role: 'bot', sent_at: '2026-10-16T17:02:00Z', delivery_status: 'sent' }],
    scoreEvents: [{ id: 'e1', lead_id: 'lead-1', event_type: 'asked_price' }] })
  assert.equal(item.firstResponseSeconds, 120); assert.equal(item.waiting, 'customer'); assert.equal(item.milestones.includes('needs'), false)
})
test('a newly expired SLA makes a previous assessment stale even without another message', () => {
  const item = fixture({ lead: { id: 'lead-1', handoff_status: 'assigned', seller_response_due_at: '2026-10-16T17:30:00Z', handoff_requested_at: '2026-10-16T17:00:00Z' },
    analyses: [{ id: 'a1', conversation_id: 'c1', created_at: '2026-10-16T17:10:00Z', source_last_message_at: '2026-10-16T17:00:00Z', analysis: { version: 2, operational_snapshot: { signals: [] } } }] })
  assert.ok(item.signals.some(s => s.key === 'advisor_overdue')); assert.equal(item.stale, true)
})
test('version filters use the current conversation trace, never the analyst model deployment or an older conversation', () => {
  const item = fixture({ versions: [{ conversation_id: 'older', started_at: asOf, output_summary: { code_version: 'wrong' } }, { conversation_id: 'c1', started_at: '2026-10-16T17:00:00Z', output_summary: { code_version: 'actual' } }] })
  assert.equal(item.codeVersion, 'actual'); assert.equal(filterAnalysisCases([item], { version: 'actual' }).length, 1)
  assert.equal(filterAnalysisCases([item], { version: 'wrong' }).length, 0)
})

test('recent activity preserves an evidenced rejection and an objection without marking the commercial opportunity lost', () => {
  const messages = [{ id: 'rejection', conversation_id: 'c1', role: 'cliente', content: 'No continuaré con la compra porque excede mi presupuesto', sent_at: '2026-10-16T17:50:00Z' },
    { id: 'thanks', conversation_id: 'c1', role: 'cliente', content: 'Gracias por la atención', sent_at: '2026-10-16T17:55:00Z' }]
  const normalized = normalizeAnalysisAssessment({ customer_position: { kind: 'declined', evidence: [{ message_id: 'rejection', quote: messages[0].content }] },
    factors: [{ kind: 'customer', reason: 'price', basis: 'explicit', explanation: 'El cliente indica un límite de presupuesto', evidence: [{ message_id: 'rejection', quote: 'excede mi presupuesto' }] }] }, messages)
  const item = fixture({ messages, analyses: [{ id: 'new', conversation_id: 'c1', created_at: asOf, source_last_message_at: messages[1].sent_at,
    analysis: { ...normalized, version: 2, inactivity: false } }] })
  assert.equal(item.analysis?.customer_position.kind, 'declined')
  assert.equal(item.factors[0].reason, 'price')
  assert.equal(item.factors[0].basis, 'explicit')
  assert.equal(item.lost, false, 'An analytical position does not write a commercial closure')
})
