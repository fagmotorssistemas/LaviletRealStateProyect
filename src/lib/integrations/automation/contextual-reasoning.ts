import { numericMentions } from './numeric-text'
import { CONTEXTUAL_NEEDS_GUIDANCE } from './needs-guidance'

/** Arithmetic evidence for this turn only. It never changes catalogue or lead state. */
export const CONTEXTUAL_REASONING_VERSION = 'contextual-reasoning-v1' as const
export type SpatialUnit = 'm' | 'cm' | 'mm' | 'm2' | 'cm2' | 'count' | 'ratio'
export type ResultUnit = 'm' | 'm2' | 'count' | 'ratio'
export type ContextualFact = { id: string; value: number; unit: SpatialUnit; subject: string; source: string }
export type ContextualReasoningEvidence = {
  version: typeof CONTEXTUAL_REASONING_VERSION
  current_message: string
  facts: ContextualFact[]
  limits: { can_confirm_fit: false; can_infer_room_dimensions: false; can_persist_assumptions: false }
  guidance: string
}
export type ContextualOperand = { value: number; unit: SpatialUnit; source: {
  kind: 'lead_current' | 'project_fact' | 'illustrative_assumption'; reference: string; quote: string
} }
export type ContextualCalculation = {
  operation: 'add' | 'subtract' | 'multiply' | 'divide'
  operands: ContextualOperand[]
  result: { value: number; unit: ResultUnit }
  scope: 'grounded' | 'illustrative'
}
export type ContextualCalculationCheck = { valid: boolean; reason: string; value?: number; unit?: ResultUnit;
  scope?: 'grounded' | 'illustrative'; not_fit_guarantee: true }

type Row = Record<string, unknown>
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : []
const units: SpatialUnit[] = ['m', 'cm', 'mm', 'm2', 'cm2', 'count', 'ratio']
const resultUnits: ResultUnit[] = ['m', 'm2', 'count', 'ratio']
const normalizedUnit: Record<SpatialUnit, { unit: ResultUnit; factor: number }> = {
  m: { unit: 'm', factor: 1 }, cm: { unit: 'm', factor: 0.01 }, mm: { unit: 'm', factor: 0.001 },
  m2: { unit: 'm2', factor: 1 }, cm2: { unit: 'm2', factor: 0.0001 },
  count: { unit: 'count', factor: 1 }, ratio: { unit: 'ratio', factor: 1 },
}
const sameNumber = (left: number, right: number) => Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
const normalizedQuantity = (value: number, unit: SpatialUnit) => ({ value: value * normalizedUnit[unit].factor, unit: normalizedUnit[unit].unit })

export const CONTEXTUAL_CALCULATION_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['operation', 'operands', 'result', 'scope'], properties: {
    operation: { type: 'string', enum: ['add', 'subtract', 'multiply', 'divide'] },
    operands: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'object', additionalProperties: false,
      required: ['value', 'unit', 'source'], properties: {
        value: { type: 'number' }, unit: { type: 'string', enum: units },
        source: { type: 'object', additionalProperties: false, required: ['kind', 'reference', 'quote'], properties: {
          kind: { type: 'string', enum: ['lead_current', 'project_fact', 'illustrative_assumption'] },
          reference: { type: 'string', description: 'ID exacto de razonamiento_contextual.facts para project_fact; cadena vacía para las otras fuentes.' },
          quote: { type: 'string', description: 'Cita literal del mensaje actual para lead_current; cita literal del borrador que declara el supuesto para illustrative_assumption; vacía para project_fact.' },
        } },
      } } },
    result: { type: 'object', additionalProperties: false, required: ['value', 'unit'], properties: {
      value: { type: 'number' }, unit: { type: 'string', enum: resultUnits },
    } },
    scope: { type: 'string', enum: ['grounded', 'illustrative'], description: 'illustrative si cualquier operando es supuesto; nunca se guarda como dato del inmueble o del lead.' },
  },
}

export const CONTEXTUAL_REASONING_RULES = 'Puede explicar relaciones y calcular con medidas que el lead declaró en el mensaje actual o con hechos espaciales verificados de razonamiento_contextual.facts. Cada operación necesita operandos, unidades y procedencia. Una hipótesis debe declararse explícitamente como ejemplo o condición en el mensaje al cliente y conservar scope=illustrative; no es una medida típica ni un dato del inmueble o del lead. Sin dimensiones no invente tamaños de camas o dormitorios: explique qué medidas faltan y cómo comparar. Una superficie total no determina largo/ancho de una habitación. La aritmética de superficies no prueba cabida, distribución, circulación, accesibilidad, número de camas ni ocupación máxima. Incluso con medidas, ventanas, puertas, mobiliario y distribución requieren verificar el espacio. El cálculo solo autoriza su resultado matemático, no una garantía física ni una acción comercial. Mantenga la orientación y el siguiente paso de la conversación; los supuestos no se guardan en el perfil ni catálogo.'

/** Read only current, structured catalogue fields. Never read history, summaries,
 * AI extraction, client profile or illustrative examples as project evidence. */
export function contextualReasoningEvidence(current: string, verified: Row): ContextualReasoningEvidence {
  const catalog = rows(verified.catalogo)
  const fields: Record<string, SpatialUnit> = { area_internal_m2: 'm2', area_exterior_m2: 'm2', area_total_m2: 'm2',
    length_m: 'm', width_m: 'm', height_m: 'm' }
  const facts: ContextualFact[] = []
  for (const unit of catalog) {
    if (!text(unit.id)) continue
    for (const [field, measure] of Object.entries(fields)) {
      if (!finite(unit[field]) || unit[field] <= 0) continue
      facts.push({ id: 'spatial:' + text(unit.id) + ':' + field, value: unit[field] as number, unit: measure,
        subject: [text(unit.category), text(unit.unit_number), field].filter(Boolean).join(' '),
        source: 'catalogo.' + text(unit.id) + '.' + field })
    }
  }
  // A conflicting source cannot silently become an arithmetic authority.
  const unique = facts.filter((fact, index) => facts.findIndex(other => other.id === fact.id) === index
    && facts.every(other => other.id !== fact.id || other.value === fact.value && other.unit === fact.unit))
  return { version: CONTEXTUAL_REASONING_VERSION, current_message: current, facts: unique,
    limits: { can_confirm_fit: false, can_infer_room_dimensions: false, can_persist_assumptions: false },
    guidance: CONTEXTUAL_NEEDS_GUIDANCE }
}

const spanishUnit = (literal: string): SpatialUnit | null => {
  const value = literal.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
  if (/^(?:m(?:2|²)|metros? cuadrados?)$/.test(value)) return 'm2'
  if (/^(?:cm(?:2|²)|centimetros? cuadrados?)$/.test(value)) return 'cm2'
  if (/^(?:m|metros?)$/.test(value)) return 'm'
  if (/^(?:cm|centimetros?)$/.test(value)) return 'cm'
  if (/^(?:mm|milimetros?)$/.test(value)) return 'mm'
  return null
}
const metricPattern = '(?:cent[ií]metros? cuadrados?|metros? cuadrados?|cm[2²]|m[2²]|cent[ií]metros?|mil[ií]metros?|metros?|cm|mm|m)'
function citedQuantity(quote: string, value: number, unit: SpatialUnit): boolean {
  const target = normalizedQuantity(value, unit), mentions = numericMentions(quote)
  const candidates: { value: number; unit: SpatialUnit | 'scalar' | 'currency'; index: number }[] = []
  const metric = new RegExp('^\\s*(' + metricPattern + ')(?![\\p{L}\\d²])', 'iu')
  for (const mention of mentions) {
    const before = quote.slice(0, mention.index), after = quote.slice(mention.end)
    const matched = after.match(metric), measured = matched && spanishUnit(matched[1])
    if (measured) {
      candidates.push({ value: mention.value, unit: measured, index: mention.index })
      continue
    }
    if (/(?:\$|\bUSD|\bd[oó]lares?)\s*$/iu.test(before) || /^\s*(?:USD|d[oó]lares?)\b/iu.test(after)) {
      candidates.push({ value: mention.value, unit: 'currency', index: mention.index }); continue
    }
    if (/^\s*(?:%|por ciento\b)/iu.test(after)) {
      candidates.push({ value: mention.value / 100, unit: 'ratio', index: mention.index }); continue
    }
    candidates.push({ value: mention.value, unit: 'scalar', index: mention.index })
  }
  // Conventional shared-unit pairs (90 x 190 cm) bind the same length unit to
  // both explicit values. The parser also handles Spanish decimal words.
  for (let index = 0; index < mentions.length - 1; index++) {
    const first = mentions[index], second = mentions[index + 1]
    const firstCandidate = candidates.find(candidate => candidate.index === first.index)
    const secondCandidate = candidates.find(candidate => candidate.index === second.index)
    if (firstCandidate?.unit === 'scalar' && secondCandidate && ['m', 'cm', 'mm'].includes(secondCandidate.unit)
      && /^\s*(?:x|×|por)\s*$/iu.test(quote.slice(first.end, second.index))) firstCandidate.unit = secondCandidate.unit
  }
  return candidates.some(candidate => {
    if (candidate.unit === 'currency') return false
    if (candidate.unit === 'scalar') return ['count', 'ratio'].includes(target.unit) && sameNumber(candidate.value, value)
    const quantity = normalizedQuantity(candidate.value, candidate.unit)
    return quantity.unit === target.unit && sameNumber(quantity.value, target.value)
  })
}

/** Bind the computed quantity to the claimed clause, not to another number
 * elsewhere in the draft. The reviewer still validates that clause's subject. */
export function groundedResultQuantityPresent(value: number, unit: ResultUnit, statement: string): boolean {
  return finite(value) && resultUnits.includes(unit) && !!statement.trim() && citedQuantity(statement, value, unit)
}

/** Validate a reviewer proof against code-owned sources. draft is the actual
 * writer message, never the reviewer's paraphrase of that message. */
export function contextualCalculationCheck(raw: unknown, evidence: ContextualReasoningEvidence, draft: string): ContextualCalculationCheck {
  const fail = (reason: string): ContextualCalculationCheck => ({ valid: false, reason, not_fit_guarantee: true })
  const proof = row(raw), operands = rows(proof.operands), result = row(proof.result)
  if (evidence?.version !== CONTEXTUAL_REASONING_VERSION || evidence.limits?.can_confirm_fit !== false
    || evidence.limits?.can_infer_room_dimensions !== false || evidence.limits?.can_persist_assumptions !== false
    || !Array.isArray(evidence.facts) || typeof evidence.current_message !== 'string')
    return fail('contextual_evidence_unavailable')
  if (!['add', 'subtract', 'multiply', 'divide'].includes(text(proof.operation)) || operands.length < 2 || operands.length > 8
    || !['grounded', 'illustrative'].includes(text(proof.scope)) || !finite(result.value) || !resultUnits.includes(result.unit as ResultUnit)
    || Object.keys(proof).some(key => !['operation', 'operands', 'result', 'scope'].includes(key))) return fail('invalid_calculation_proof')
  if (['subtract', 'divide'].includes(text(proof.operation)) && operands.length !== 2) return fail('invalid_operation_arity')
  const normalized: { value: number; unit: ResultUnit }[] = []
  let assumed = false
  for (const operand of operands) {
    if (!finite(operand.value) || !units.includes(operand.unit as SpatialUnit) || operand.value < 0
      || operand.unit === 'count' && !Number.isInteger(operand.value)) return fail('invalid_operand')
    const source = row(operand.source), kind = text(source.kind), quote = text(source.quote)
    const quantity = normalizedQuantity(operand.value, operand.unit as SpatialUnit)
    if (kind === 'project_fact') {
      const references = evidence.facts.filter(fact => fact.id === source.reference)
      if (references.length !== 1) return fail('unknown_project_operand')
      const fact = references[0]
      if (!finite(fact.value) || !units.includes(fact.unit)) return fail('invalid_project_operand_source')
      const expected = normalizedQuantity(fact.value, fact.unit)
      if (expected.unit !== quantity.unit || !sameNumber(expected.value, quantity.value)) return fail('project_operand_mismatch')
    } else if (kind === 'lead_current') {
      if (!quote.trim() || !evidence.current_message.includes(quote) || !citedQuantity(quote, operand.value, operand.unit as SpatialUnit))
        return fail('ungrounded_lead_operand')
    } else if (kind === 'illustrative_assumption') {
      if (!quote.trim() || !draft.includes(quote) || !/(?:\bsi\b|\bsupon(?:g|iendo)|\bhipot[eé]tic|\bpor ejemplo\b|\bcomo ejemplo\b)/iu.test(quote)
        || !citedQuantity(quote, operand.value, operand.unit as SpatialUnit)) return fail('assumption_not_explicit_in_draft')
      assumed = true
    } else return fail('unknown_operand_source')
    normalized.push(quantity)
  }
  if (assumed && proof.scope !== 'illustrative') return fail('calculation_scope_mismatch')
  let computed = normalized[0].value, computedUnit = normalized[0].unit
  for (const next of normalized.slice(1)) {
    if (proof.operation === 'add' || proof.operation === 'subtract') {
      if (computedUnit !== next.unit) return fail('incompatible_operand_units')
      computed = proof.operation === 'add' ? computed + next.value : computed - next.value
    } else if (proof.operation === 'multiply') {
      if (computedUnit === 'm' && next.unit === 'm') computedUnit = 'm2'
      else if (computedUnit === 'ratio' || computedUnit === 'count' && next.unit !== 'ratio') computedUnit = next.unit
      else if (!['count', 'ratio'].includes(next.unit)) return fail('unsupported_spatial_operation')
      computed *= next.value
    } else {
      if (next.value === 0) return fail('division_by_zero')
      if (computedUnit === next.unit) computedUnit = 'ratio'
      else if (!['count', 'ratio'].includes(next.unit)) return fail('unsupported_spatial_operation')
      computed /= next.value
    }
  }
  // Arithmetic may produce a difference or ratio, never a reconstructed room
  // dimension from catalogue area, nor a guarantee that furniture can be placed.
  if (!finite(computed) || computedUnit !== result.unit || !sameNumber(computed, result.value as number))
    return fail('calculation_result_mismatch')
  return { valid: true, reason: 'arithmetic_verified_only', value: computed, unit: computedUnit,
    scope: proof.scope as 'grounded' | 'illustrative', not_fit_guarantee: true }
}
