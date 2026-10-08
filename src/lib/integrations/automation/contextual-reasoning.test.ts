import test from 'node:test'
import assert from 'node:assert/strict'
import { contextualReasoningEvidence, contextualCalculationCheck, groundedResultQuantityPresent, type ContextualCalculation, type ContextualOperand } from './contextual-reasoning'
const lead = (value: number, unit: ContextualOperand['unit'], quote: string): ContextualOperand => ({ value, unit, source: { kind: 'lead_current', reference: '', quote } })
const assumed = (value: number, unit: ContextualOperand['unit'], quote: string): ContextualOperand => ({ value, unit, source: { kind: 'illustrative_assumption', reference: '', quote } })
const proof = (operation: ContextualCalculation['operation'], operands: ContextualOperand[], value: number, unit: ContextualCalculation['result']['unit'], scope: ContextualCalculation['scope'] = 'grounded'): ContextualCalculation => ({ operation, operands, result: { value, unit }, scope })

test('current declared bed dimensions support arithmetic with explicit conversions, never physical fit', () => {
  const current = 'Mis dos camas miden 90 x 190 cm cada una.'
  const evidence = contextualReasoningEvidence(current, {})
  const calculated = contextualCalculationCheck(proof('multiply', [lead(0.9, 'm', '90 x 190 cm'), lead(190, 'cm', '90 x 190 cm'), lead(2, 'count', 'dos camas')], 3.42, 'm2'), evidence, 'Las huellas suman 3,42 m²; eso no confirma su cabida ni circulación.')
  assert.equal(calculated.valid, true)
  assert.equal(calculated.unit, 'm2')
  assert.equal(calculated.scope, 'grounded')
  assert.equal(calculated.not_fit_guarantee, true)
  assert.equal(evidence.limits.can_confirm_fit, false)
})

test('a wrong result, invented lead measurement, incompatible units and zero division are rejected', () => {
  const evidence = contextualReasoningEvidence('La cama mide 1 m por 2 m y la otra mide 0 m.', {})
  assert.equal(contextualCalculationCheck(proof('multiply', [lead(1, 'm', '1 m'), lead(2, 'm', '2 m')], 3, 'm2'), evidence, '').reason, 'calculation_result_mismatch')
  assert.equal(contextualCalculationCheck(proof('multiply', [lead(1.5, 'm', '1 m'), lead(2, 'm', '2 m')], 3, 'm2'), evidence, '').reason, 'ungrounded_lead_operand')
  assert.equal(contextualCalculationCheck(proof('add', [lead(1, 'm', '1 m'), lead(2, 'm2', '2 m')], 3, 'm'), evidence, '').reason, 'ungrounded_lead_operand')
  assert.equal(contextualCalculationCheck(proof('divide', [lead(1, 'm', '1 m'), lead(0, 'm', '0 m')], 0, 'ratio'), evidence, '').reason, 'division_by_zero')
})

test('assumptions must be explicit in the actual draft, never only in reviewer metadata', () => {
  const evidence = contextualReasoningEvidence('¿Cómo podría evaluar dos camas?', {})
  const quote = 'Por ejemplo, si cada cama midiera 1 m por 2 m'
  const calculation = proof('multiply', [assumed(1, 'm', quote), assumed(2, 'm', quote)], 2, 'm2', 'illustrative')
  const before = JSON.stringify(evidence)
  assert.equal(contextualCalculationCheck(calculation, evidence, quote + ', su huella sería de 2 m², sin confirmar cabida.').valid, true)
  assert.equal(contextualCalculationCheck(calculation, evidence, 'Las camas miden 1 m por 2 m y caben.').reason, 'assumption_not_explicit_in_draft')
  assert.equal(contextualCalculationCheck({ ...calculation, scope: 'grounded' }, evidence, quote).reason, 'calculation_scope_mismatch')
  assert.equal(JSON.stringify(evidence), before)
  assert.equal(evidence.facts.length, 0)
  assert.equal(evidence.limits.can_persist_assumptions, false)
})

test('only current canonical catalogue fields ground project calculations', () => {
  const verified = { catalogo: [{ id: 'u202', unit_number: '202', category: 'departamento', area_internal_m2: 120.83, area_exterior_m2: 27.03 }],
    history: [{ room_width_m: 4 }], perfil_lead: { width_m: 7 }, resumen: { width_m: 6 },
    illustrative_example: { room_width_m: 5 }, extraccion: { room_width_m: 3 } }
  const before = JSON.stringify(verified)
  const evidence = contextualReasoningEvidence('Quiero sumar las superficies.', verified)
  assert.equal(evidence.facts.length, 2)
  const project = (index: number): ContextualOperand => ({ value: evidence.facts[index].value, unit: evidence.facts[index].unit,
    source: { kind: 'project_fact', reference: evidence.facts[index].id, quote: '' } })
  const result = contextualCalculationCheck(proof('add', [project(0), project(1)], 147.86, 'm2'), evidence, 'La suma aritmética es 147,86 m²; no representa una medida oficial del dormitorio.')
  assert.equal(result.valid, true)
  const fabricated = project(0); fabricated.source.reference = 'spatial:u202:room_width_m'
  assert.equal(contextualCalculationCheck(proof('add', [fabricated, project(1)], 147.86, 'm2'), evidence, '').reason, 'unknown_project_operand')
  assert.equal(JSON.stringify(verified), before)
})

test('area and a length cannot be used to infer dimensions of a room', () => {
  const evidence = contextualReasoningEvidence('Tengo una cama de 2 m.', { catalogo: [{ id: 'u202', area_internal_m2: 120.83 }] })
  const area: ContextualOperand = { value: 120.83, unit: 'm2', source: { kind: 'project_fact', reference: evidence.facts[0].id, quote: '' } }
  assert.equal(contextualCalculationCheck(proof('divide', [area, lead(2, 'm', '2 m')], 60.415, 'm'), evidence, '').reason, 'unsupported_spatial_operation')
  assert.equal(contextualCalculationCheck(proof('multiply', [area, lead(2, 'm', '2 m')], 241.66, 'm2'), evidence, '').reason, 'unsupported_spatial_operation')
})

test('five children and a total apartment area do not create room or furniture dimensions', () => {
  const evidence = contextualReasoningEvidence('Tengo 5 hijos, ¿entran dos camas en una habitación?', { catalogo: [{ id: 'u602', area_internal_m2: 142.09 }] })
  assert.equal(evidence.facts.length, 1)
  assert.equal(evidence.facts[0].subject, 'area_internal_m2')
  assert.equal(contextualCalculationCheck(proof('multiply', [lead(1, 'm', 'dos camas'), lead(2, 'm', 'dos camas')], 2, 'm2'), evidence, '').valid, false)
  assert.equal(evidence.limits.can_infer_room_dimensions, false)
})

test('a stale source or negative verdict cannot be smuggled in as a verified calculation', () => {
  const evidence = contextualReasoningEvidence('Ahora busco una habitación grande.', { catalogo: [{ id: 'u202', area_internal_m2: 120.83 }, { id: 'u202', area_internal_m2: 121 }] })
  assert.equal(evidence.facts.length, 0)
  assert.equal(contextualCalculationCheck(proof('multiply', [lead(1, 'm', '1 m'), lead(2, 'm', '2 m')], 2, 'm2'), evidence, '').reason, 'ungrounded_lead_operand')
  const assumedQuote = 'Si las medidas fueran 1 m y 2 m'
  const calc = proof('multiply', [assumed(1, 'm', assumedQuote), assumed(2, 'm', assumedQuote)], 2, 'm2', 'illustrative')
  assert.equal(contextualCalculationCheck({ ...calc, can_fit: true }, evidence, assumedQuote).reason, 'invalid_calculation_proof')
})


test('a scenario declared by the lead can remain illustrative without becoming a project fact', () => {
  const current = 'Si las camas fueran de 1 m por 2 m, ¿qué superficie ocuparían?'
  const evidence = contextualReasoningEvidence(current, {})
  const checked = contextualCalculationCheck(proof('multiply', [lead(1, 'm', '1 m'), lead(2, 'm', '2 m')], 2, 'm2', 'illustrative'), evidence, 'En ese escenario, cada huella sería de 2 m²; no confirma su cabida.')
  assert.equal(checked.valid, true)
  assert.equal(checked.scope, 'illustrative')
  assert.equal(evidence.facts.length, 0)
})


test('common measurements written in words preserve their numerical meaning', () => {
  const current = 'La cama mide un metro por dos metros.'
  const checked = contextualCalculationCheck(proof('multiply', [lead(1, 'm', 'un metro'), lead(2, 'm', 'dos metros')], 2, 'm2'), contextualReasoningEvidence(current, {}), '')
  assert.equal(checked.valid, true)
})


test('a calculated result must match the actual claimed quantity and dimension', () => {
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'Las huellas suman 3,42 m².'), true)
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'Las huellas suman 3,5 m².'), false)
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'El ancho combinado es de 3,42 m.'), false)
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'Las huellas suman 34200 cm².'), true)
  assert.equal(groundedResultQuantityPresent(2, 'm2', 'La huella equivale a dos metros cuadrados.'), true)
  assert.equal(groundedResultQuantityPresent(2, 'count', 'El ancho equivale a dos metros.'), false)
  assert.equal(groundedResultQuantityPresent(2, 'count', 'Se calcula para dos camas.'), true)
  assert.equal(groundedResultQuantityPresent(2, 'm', 'Dos camas suman cuatro metros de ancho.'), false)
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', ''), false)
})


test('result and source binding accept Spanish decimal words without confusing currency or percentages', () => {
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'Las huellas suman tres coma cuarenta y dos metros cuadrados.'), true)
  assert.equal(groundedResultQuantityPresent(3.42, 'm2', 'Las huellas suman tres coma cinco metros cuadrados.'), false)
  assert.equal(groundedResultQuantityPresent(2, 'count', 'El resultado es de dos metros.'), false)
  assert.equal(groundedResultQuantityPresent(2, 'count', 'El importe es de dos dólares.'), false)
  assert.equal(groundedResultQuantityPresent(50, 'ratio', 'La proporción es 50%.'), false)
  assert.equal(groundedResultQuantityPresent(0.5, 'ratio', 'La proporción es cincuenta por ciento.'), true)
  const current = 'La cama mide cero coma nueve metros por uno coma nueve metros.'
  const checked = contextualCalculationCheck(proof('multiply', [lead(0.9, 'm', 'cero coma nueve metros'), lead(1.9, 'm', 'uno coma nueve metros')], 1.71, 'm2'), contextualReasoningEvidence(current, {}), '')
  assert.equal(checked.valid, true)
})
