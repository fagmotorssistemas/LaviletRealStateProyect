import assert from 'node:assert/strict'
import test from 'node:test'
import { compactTurnPromptContext } from './turn-prompt-context'
import { normalizeReviewReferences } from './turn-evidence'
import { factualValueIssues } from './semantic-review'
import { structuredReviewSchema } from './structured-facts'

test('task projection distinguishes a proposed subject from the original need and preserves pending consent', () => {
  const proposal_information = { version: 'proposal-information-v1', active: true, informational_only: true,
    query: { filters: { bedrooms: 3 }, operation: 'details', scope: 'offered' },
    original_query: { filters: { bedrooms: 5 } }, candidate_ids: ['d302'], resolved_ids: ['d302'],
    pending_question_id: 'property_requirements', complete: true }
  const source = { property_context: { query: { filters: { bedrooms: 5 } }, proposal_information,
    pending_question: { id: 'property_requirements', act: 'explore_alternatives' } },
    contexto_verificado: { prompt_context_selection: { version: 'task-context-v1' } },
    evidencia_turno: { units: [{ id: 'd302', unit_number: '302', bedrooms: 3 }] } }
  const projected = compactTurnPromptContext(source)
  const property = projected.property_context as typeof source.property_context
  assert.equal(property.proposal_information.active, true)
  assert.equal(property.proposal_information.informational_only, true)
  assert.equal(property.proposal_information.query.filters.bedrooms, 3)
  assert.equal(property.query.filters.bedrooms, 5)
  assert.equal(property.pending_question.id, 'property_requirements')
  assert.deepEqual(property.proposal_information.resolved_ids, ['302'])
  assert.deepEqual(source.property_context.proposal_information.resolved_ids, ['d302'])
})

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

test('reviewer projection retains source UUIDs consistent with its strict factual schema', () => {
  const units = [
    { id: '7e14b9fb-a318-43f2-9f8d-475be12140d1', unit_number: '202', published_commercial_price: 250000 },
    { id: '3a27abf1-a424-44a1-bdcd-7a893af3672c', unit_number: '302', published_commercial_price: 290000 },
  ]
  const group = { id: 'group:departamento:all:range', aggregation: 'range', member_ids: units.map(unit => unit.id),
    published_commercial_price: 250000, upper_values: { published_commercial_price: 290000 } }
  const context = { evidencia_turno: { units, groups: [group] }, contexto_verificado: { catalogo: units },
    evidencia_afirmaciones: units.map((unit, index) => ({ id: `E${index + 1}`, kind: 'project_fact',
      path: `evidencia_turno.units.${index}`, reference_id: unit.id, reference_label: unit.unit_number })) }
  const schema = structuredReviewSchema({ properties: {}, required: [] }, ['S1'], [...units, group], [])
  const projected = compactTurnPromptContext(context, { preserveUnitIds: true }) as typeof context
  const values = (schema.properties as Record<string, { items: { anyOf: { properties: { unit_id: { enum: string[] } } }[] } }>).factual_values
  const allowed = new Set(values.items.anyOf.flatMap(variant => variant.properties.unit_id.enum))
  assert.deepEqual(projected.evidencia_turno.units, units)
  assert.deepEqual(projected.evidencia_turno.groups[0].member_ids, units.map(unit => unit.id))
  assert.deepEqual(projected.contexto_verificado.catalogo, units.map(unit => ({ unit_ref: unit.id })))
  for (const [index, unit] of projected.evidencia_turno.units.entries()) {
    assert.ok(allowed.has(unit.id), 'the model sees the exact identifier accepted by the strict schema')
    assert.equal(projected.evidencia_afirmaciones[index].reference_id, unit.id)
    assert.equal(projected.evidencia_afirmaciones[index].reference_label, unit.unit_number)
    assert.equal(allowed.has(unit.unit_number), false)
  }
  assert.ok(allowed.has(projected.evidencia_turno.groups[0].id))
  assert.deepEqual((compactTurnPromptContext(context).evidencia_turno as typeof context.evidencia_turno).units.map(unit => unit.id),
    ['202', '302'], 'writer projection still supports compact labels')
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

test('source payloads reference identical authoritative facts and preserve missing or conflicting paths', () => {
  const policy = { id: 'policy-1', text: 'El asesor revisará los requisitos para comprar desde el extranjero.' }
  const action = { status: 'requested', advisor_assigned: false }
  const source = { contexto_verificado: { politicas_negocio: [policy] }, estado_operativo: { reservation: action },
    evidencia_afirmaciones: [
      { id: 'E1', kind: 'project_fact', path: 'contexto_verificado.politicas_negocio.0', value: policy },
      { id: 'E2', kind: 'operational_fact', path: 'estado_operativo.reservation', value: action },
      { id: 'E3', kind: 'project_fact', path: 'contexto_verificado.politicas_negocio.0', value: { ...policy, text: 'Compra aprobada.' } },
      { id: 'E4', kind: 'project_fact', path: 'contexto_verificado.politicas_negocio.9', value: policy },
      { id: 'E5', kind: 'project_fact', path: 'materiales_configurados.brochure', value: { url: 'https://example.org/brochure.pdf' } },
    ] }
  const original = JSON.stringify(source)
  const result = compactTurnPromptContext(source)
  const sources = result.evidencia_afirmaciones as Record<string, unknown>[]
  assert.deepEqual(sources[0], { ...source.evidencia_afirmaciones[0], value: { ref: 'contexto_verificado.politicas_negocio.0' } })
  assert.deepEqual(sources[1], { ...source.evidencia_afirmaciones[1], value: { ref: 'estado_operativo.reservation' } })
  assert.deepEqual(sources.slice(2), source.evidencia_afirmaciones.slice(2))
  assert.deepEqual(result.contexto_verificado, source.contexto_verificado)
  assert.deepEqual(result.estado_operativo, source.estado_operativo)
  assert.equal(JSON.stringify(source), original)
})
