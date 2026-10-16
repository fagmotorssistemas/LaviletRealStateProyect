import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { projectObjectionRequests, withProjectObjectionContext } from './project-objections'

const request = (evidence = '¿Por qué tan caro?', extra: Row = {}): Row => ({ domain: 'property',
  topics: ['value_objection'], confidence: 'high', request: 'Explicar el valor del proyecto', evidence, source: 'current', ...extra })

test('only admitted typed property objections create guidance; wording is not interpreted by keyword', () => {
  for (const evidence of ['¿Por qué tan caro?', 'No veo qué aporta a lo que necesito.', 'Me preocupa vivir en ese sector.']) {
    const input: Row = { solicitudes_interpretadas: [request(evidence)] }
    assert.equal(projectObjectionRequests(input, evidence).length, 1)
    assert.equal(object(withProjectObjectionContext(input, evidence).objeciones_proyecto).version, 'project-objections-v1')
  }
  for (const extra of [{ confidence: 'low' }, { topics: ['purchase_price'] }, { topics: [] },
    { domain: 'financing' }, { source: 'history' }, { evidence: 'No me parece suficiente.' }]) {
    assert.deepEqual(projectObjectionRequests({ solicitudes_interpretadas: [request(undefined, extra)] }, '¿Por qué tan caro?'), [])
  }
  assert.deepEqual(projectObjectionRequests({ historial: [{ role: 'cliente', content: '¿Por qué tan caro?' }] }, 'claro'), [])
})

test('current contracts and extracted requests deduplicate without promoting pending extraction to shared authority', () => {
  const current = '¿Por qué tan caro?', first = request()
  const input: Row = { contrato_turno: { requests: [first] }, solicitudes_interpretadas: [{ ...first, source: undefined }] }
  assert.equal(projectObjectionRequests(input, current).length, 1)
  assert.deepEqual(projectObjectionRequests({ solicitudes_interpretadas: [request('Eso es caro', { source: 'pending', source_message_id: 'm1' })],
    consultas_pendientes: [{ id: 'm1', content: 'Eso es caro' }] }, 'sí'), [])
})

test('pending objections require a shared request, matching message identity, literal evidence and unanswered status', () => {
  const input: Row = { contrato_turno: { requests: [request('Me queda lejos', { source: 'pending', source_message_id: 'm1' })] },
    consultas_pendientes: [{ message_id: 'm1', content: 'Me queda lejos' }] }
  assert.equal(projectObjectionRequests(input, 'claro').length, 1)
  const variations: ((copy: Row) => void)[] = [
    copy => { object(copy.contrato_turno).requests = [request('Me queda lejos', { source: 'pending' })] },
    copy => { copy.consultas_pendientes = [{ message_id: 'm2', content: 'Me queda lejos' }] },
    copy => { copy.consultas_pendientes = [{ message_id: 'm1', content: 'Quiero conocer el proyecto' }] },
    copy => { copy.consultas_pendientes = [{ message_id: 'm1', content: 'Me queda lejos', answered: true }] },
    ...['answered', 'resolved', 'cancelled', 'superseded'].map(status => (copy: Row) => {
      copy.consultas_pendientes = [{ message_id: 'm1', content: 'Me queda lejos', status }]
    }),
  ]
  for (const vary of variations) {
    const copy = structuredClone(input); vary(copy)
    assert.deepEqual(projectObjectionRequests(copy, 'claro'), [])
  }
})

test('approved concept is separate from guidance and never copies catalogue, exact location, financial or amenity snapshots', () => {
  const current = '¿Por qué tan caro?'
  const input: Row = { solicitudes_interpretadas: [request()], lead: { budget: 100000, unit_id: 'kept-unit' },
    instalaciones: [{ amenity_name: 'Piscina', access_condition: 'Solo residentes' }],
    posicionamiento_proyecto: { concept: 'Concepto anterior' }, proyecto: { address: 'Dirección exacta privada' },
    politicas_negocio: [{ content: 'Política privada pendiente' }],
    catalogo: [{ id: 'kept-unit', published_commercial_price: 250000 }],
    financing_quote: { amount: 180000 }, interaction_mode: { mode: 'information_only' } }
  const before = structuredClone(input), result = withProjectObjectionContext(input, current)
  assert.deepEqual(input, before)
  for (const key of Object.keys(input)) assert.deepEqual(result[key], input[key])
  const context = object(result.objeciones_proyecto), facts = object(context.project_facts)
  assert.equal(facts.commercial_floors, 2)
  assert.match(String(facts.commercial_offer_status), /no acredita negocios/)
  assert.ok(Object.keys(object(context.guidance)).includes('security'))
  assert.doesNotMatch(JSON.stringify(context), /Dirección exacta privada|250000|180000|Piscina|Política privada pendiente/)
  assert.deepEqual(withProjectObjectionContext(result, current), result)
})

test('stale objection context is cleared after the concern is resolved without changing lead decisions', () => {
  const before: Row = { objeciones_proyecto: { version: 'old', project_facts: { unsupported: true } },
    lead: { unit_id: '605' }, financiamiento: { consent: true } }
  const after = withProjectObjectionContext(before, 'gracias')
  assert.equal(after.objeciones_proyecto, undefined)
  assert.deepEqual(after.lead, before.lead)
  assert.deepEqual(after.financiamiento, before.financiamiento)
  assert.ok(before.objeciones_proyecto)
})
