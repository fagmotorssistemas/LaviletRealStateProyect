import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advisorAttentionPriority,
  advisorAttentionTitle,
  advisorAttentionView,
  advisorAttentionWaitLabel,
} from './advisorAttention'

test('separa la cola según estado y asesor', () => {
  assert.equal(advisorAttentionView({ handoff_status: 'queued', assigned_to: null }, 'u1'), 'pending')
  assert.equal(advisorAttentionView({ handoff_status: 'assigned', assigned_to: 'u1' }, 'u1'), 'mine')
  assert.equal(advisorAttentionView({ handoff_status: 'assigned', assigned_to: 'u2' }, 'u1'), 'pending')
  assert.equal(advisorAttentionView({ handoff_status: 'acknowledged', assigned_to: 'u1' }, 'u1'), 'mine')
  assert.equal(advisorAttentionView({ handoff_status: 'acknowledged', assigned_to: 'u2' }, 'u1'), 'pending')
  assert.equal(advisorAttentionView({ handoff_status: 'resolved', assigned_to: 'u1' }, 'u1'), null)
  assert.equal(advisorAttentionView({ handoff_status: 'none', assigned_to: null }, 'u1'), null)
})

test('prioriza citas y SLA vencido', () => {
  assert.equal(advisorAttentionPriority({ sla_status: 'vencido', handoff_reason: null, last_visit_status: null }), 'high')
  assert.equal(advisorAttentionPriority({ sla_status: 'no_aplica', handoff_reason: 'Reagendar la cita', last_visit_status: null }), 'high')
  assert.equal(advisorAttentionPriority({ sla_status: 'pendiente', handoff_reason: 'Financiamiento', last_visit_status: null }), 'medium')
  assert.equal(advisorAttentionPriority({ sla_status: 'no_aplica', handoff_reason: 'Consulta del proyecto', last_visit_status: null }), 'normal')
})

test('presenta títulos operativos y tiempo de espera', () => {
  assert.equal(advisorAttentionTitle('El cliente quiere reagendar su visita'), 'Reagendar cita')
  assert.equal(advisorAttentionTitle('Consulta sobre Banco Pichincha'), 'Revisar financiamiento')
  assert.equal(advisorAttentionWaitLabel('2026-09-20T12:00:00.000Z', Date.parse('2026-09-20T13:25:00.000Z')), '1 h 25 min esperando')
})
