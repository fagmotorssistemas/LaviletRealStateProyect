import assert from 'node:assert/strict'
import test from 'node:test'
import { compactTurnPromptContext } from './turn-prompt-context'
import { normalizeReviewReferences } from './turn-evidence'
import { factualValueIssues } from './semantic-review'

test('prompt projection keeps one authoritative catalog and preserves every unit and range', () => {
  const units = Array.from({ length: 65 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, unit_number: String(201 + index),
    category: 'departamento', bedrooms: 3, published_commercial_price: 200000 + index * 1000,
    area_internal_m2: 120.83, spaces: ['sala', 'cocina'], available: true,
  }))
  const groups = [{ id: 'group:context:all:range', aggregation: 'range', member_ids: units.map(unit => unit.id),
    published_commercial_price: 200000, upper_values: { published_commercial_price: 264000 } }]
  const intent = { objective: 'ask_price', current_message: 'Precio', required_facts: ['price'] }
  const audit = { source: 'unit_price', price_evidence: { units, ranges: [{ min: 200000, max: 264000 }] } }
  const source = { contrato_turno: intent, estado_operativo: audit, evidencia_turno: { units, groups },
    contexto_verificado: { catalogo: units, estado_operativo: audit, contrato_turno: intent,
      limite_alcance: { kind: 'mixed', outside_subject: 'vuelo' },
      politica_financiera: { direct_credit: false }, estado_proyecto: { stage: 'not_started' } },
    contrato_redaccion: { hechos_protegidos: units, price_evidence: audit.price_evidence } }
  const original = JSON.stringify(source)
  const result = compactTurnPromptContext(source) as typeof source
  assert.equal(JSON.stringify(source), original, 'validation evidence is never mutated')
  assert.equal(result.evidencia_turno.units.length, 65)
  for (let index = 0; index < units.length; index++) {
    assert.deepEqual(result.evidencia_turno.units[index], { ...units[index], id: units[index].unit_number })
  }
  assert.deepEqual(result.evidencia_turno.groups[0].member_ids, units.map(unit => unit.unit_number))
  assert.equal(result.evidencia_turno.groups[0].upper_values.published_commercial_price, 264000)
  assert.deepEqual(result.contexto_verificado.catalogo[0], { unit_ref: '201' })
  assert.deepEqual(result.contexto_verificado.estado_operativo, { ref: 'estado_operativo' })
  assert.deepEqual(result.contexto_verificado.limite_alcance, source.contexto_verificado.limite_alcance)
  assert.deepEqual(result.contexto_verificado.politica_financiera, { direct_credit: false })
  assert.deepEqual(result.contexto_verificado.estado_proyecto, { stage: 'not_started' })
  assert.ok(JSON.stringify(result).length < original.length * 0.45, 'duplicate catalog dominates this realistic fixture')
})

test('model unit aliases resolve back to exact catalog identity and still reject false prices', () => {
  const unit = { id: 'uuid-for-202', unit_number: '202', published_commercial_price: 250000 }
  const context = compactTurnPromptContext({ evidencia_turno: { units: [unit] } })
  const modelUnit = (context.evidencia_turno as { units: typeof unit[] }).units[0]
  for (const price of [250000, 999999]) {
    const reply = `El departamento 202 cuesta $${price}.`
    const review = { factual_values: [{ fragment: 'S1', unit_id: modelUnit.id, field: 'published_commercial_price',
      value: price, operator: 'eq', upper_value: null }] }
    const normalized = normalizeReviewReferences(review, [unit], reply)
    assert.equal((normalized.review.factual_values as { unit_id: string }[])[0].unit_id, unit.id)
    assert.equal(factualValueIssues(normalized.review.factual_values, reply, [unit]).length, price === 250000 ? 0 : 1)
  }
})

test('projection preserves differing evidence and avoids ambiguous identity aliases', () => {
  const units = [{ id: 'unit-a', unit_number: '202', published_commercial_price: 250000 },
    { id: 'unit-b', unit_number: '202', published_commercial_price: 300000 }]
  const result = compactTurnPromptContext({ evidencia_turno: { units },
    contexto_verificado: { catalogo: [{ ...units[0], published_commercial_price: 999999 }] } })
  assert.deepEqual((result.evidencia_turno as { units: unknown[] }).units, units)
  assert.deepEqual((result.contexto_verificado as { catalogo: unknown[] }).catalogo,
    [{ unit_ref: 'unit-a', published_commercial_price: 999999 }])
})

test('equal canonical blocks remain authoritative instead of becoming cyclic references', () => {
  const common = { selected_ids: ['202'], pending_question: 'Which option would you like to review?' }
  const result = compactTurnPromptContext({ property_context: common, estado_operativo: { ...common },
    contexto_verificado: { property_context: common } })
  assert.deepEqual(result.property_context, common)
  assert.deepEqual(result.estado_operativo, common)
  assert.deepEqual((result.contexto_verificado as Record<string, unknown>).property_context, { ref: 'property_context' })
})

test('aggregate membership is stored once with resolvable references for matching groups', () => {
  const units = Array.from({ length: 15 }, (_, index) => ({ id: `unit-unique-identifier-${index}`, unit_number: `${201 + index}` }))
  const member_ids = units.map(unit => unit.id)
  const result = compactTurnPromptContext({ evidencia_turno: { units,
    groups: [{ id: 'group:context:all:min', member_ids }, { id: 'group:context:all:max', member_ids }] } })
  const groups = (result.evidencia_turno as { groups: { member_ids: unknown }[] }).groups
  assert.deepEqual(groups[0].member_ids, units.map(unit => unit.unit_number))
  assert.deepEqual(groups[1].member_ids, { ref: 'evidencia_turno.groups.0.member_ids' })
})

test('unit aliases never rewrite customer messages or literal review fragments', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  const result = compactTurnPromptContext({ mensaje_actual: id, respuesta_base: id,
    cobertura_propuesta: [{ fragment: id, evidence: id }],
    property_context: { selected_ids: [id] },
    evidencia_turno: { units: [{ id, unit_number: '202' }] } })
  assert.equal(result.mensaje_actual, id)
  assert.equal(result.respuesta_base, id)
  assert.deepEqual(result.cobertura_propuesta, [{ fragment: id, evidence: id }])
  assert.deepEqual(result.property_context, { selected_ids: ['202'] })
})
