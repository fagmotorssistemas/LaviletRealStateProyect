import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyLeadControl, type LeadControlInput } from './leadControl'

const NOW = new Date('2026-09-21T15:00:00.000Z')

function input(overrides: Partial<LeadControlInput> = {}): LeadControlInput {
  return {
    leadId: 'lead-1', kommoId: 123, name: 'Carlos', phone: '0987110032', projectName: 'La Vilet',
    stage: 'precalificacion', temperature: 'tibio', botEnabled: true, trackingOptOutAt: null,
    assigneeName: null, assignedTo: null, handoffStatus: 'none', handoffReason: null,
    sellerResponseDueAt: null, lastInteractionAt: '2026-09-21T14:58:00.000Z', lastMessage: null,
    latestAppointment: null, executions: [], now: NOW, ...overrides,
  }
}

test('prioriza un nodo fallido y conserva el punto exacto de la caída', () => {
  const row = classifyLeadControl(input({ executions: [{
    id: 'event-1', kind: 'inbound', status: 'completed', action: null,
    occurredAt: '2026-09-21T14:59:00.000Z', availableAt: '2026-09-21T14:58:00.000Z', message: 'Hola', steps: [
      { order: 1, key: 'message_received', label: 'Mensaje recibido', category: 'input', status: 'succeeded', source: 'webhook.ts', startedAt: '2026-09-21T14:58:59.000Z', completedAt: '2026-09-21T14:58:59.100Z', durationMs: 100, errorCode: null, input: {}, output: {} },
      { order: 2, key: 'message_delivery', label: 'Enviar respuesta', category: 'output', status: 'failed', source: 'kommo.ts', startedAt: '2026-09-21T14:58:59.100Z', completedAt: '2026-09-21T14:59:00.000Z', durationMs: 900, errorCode: 'KOMMO_TIMEOUT', input: {}, output: {} },
    ],
  }] }))
  assert.equal(row.state, 'intervention')
  assert.equal(row.category, 'delivery')
  assert.equal(row.lastSuccessfulNode, 'Mensaje recibido')
  assert.equal(row.stoppedNode, 'Enviar respuesta')
})

test('detecta un mensaje del cliente sin respuesta cuando el bot está activo', () => {
  const row = classifyLeadControl(input({
    lastMessage: { role: 'cliente', content: '¿Qué opciones tengo?', sentAt: '2026-09-21T14:40:00.000Z' },
  }))
  assert.equal(row.reasonCode, 'CUSTOMER_UNANSWERED')
  assert.equal(row.state, 'intervention')
})

test('una desactivación autorizada se muestra como pausa intencional', () => {
  const row = classifyLeadControl(input({ botEnabled: false }))
  assert.equal(row.state, 'intentional')
  assert.equal(row.reasonCode, 'AUTOMATION_DISABLED')
})

test('una nutrición pendiente para el futuro no se marca como evento atascado', () => {
  const row = classifyLeadControl(input({ executions: [{
    id: 'nutrition-1', kind: 'maintenance', status: 'pending', action: null,
    occurredAt: '2026-09-21T14:00:00.000Z', availableAt: '2026-09-28T14:00:00.000Z', message: null, steps: [],
  }] }))
  assert.equal(row.reasonCode, 'NORMAL_FLOW')
})

test('un traspaso vencido conserva prioridad sobre la pausa del bot', () => {
  const row = classifyLeadControl(input({
    botEnabled: false, handoffStatus: 'assigned', assignedTo: 'advisor-1', assigneeName: 'Carlos Argudo',
    sellerResponseDueAt: '2026-09-21T14:50:00.000Z',
  }))
  assert.equal(row.reasonCode, 'ADVISOR_SLA_OVERDUE')
  assert.equal(row.category, 'advisor')
})
