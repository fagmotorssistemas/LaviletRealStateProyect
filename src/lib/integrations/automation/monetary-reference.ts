import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

export const AMOUNT_REFERENCE_SCHEMA = { type: ['string', 'null'],
  description: 'ID exacto de referencias_monetarias_confirmadas cuando el importe se resuelve desde una referencia contextual; null para una cantidad nueva expresada ahora. Nunca cite el historial como evidencia actual.' }

export const MONETARY_REFERENCE_RULES = `REFERENCIAS MONETARIAS: referencias_monetarias_confirmadas contiene únicamente importes previamente confirmados de esta conversación, identificados por id y role. Usted interpreta el lenguaje y resuelve la magnitud: «esos 100», «ese dinero», «lo mismo que indiqué» o una confirmación pueden apuntar a un importe conocido sin repetir mil, dólares ni la cifra. Cuando el referente sea inequívoco, devuelva el importe completo y amount_reference_id con su id exacto tanto en budget como en el financing_amounts correspondiente. evidence sigue siendo una cita del mensaje ACTUAL que confirma, aclara o reasigna el dinero; la evidencia del referente anterior nunca sustituye esa cita. El rol del referente identifica de dónde viene la cifra, no su destino: confirmar que el presupuesto será entrada produce initial_capital/down_payment y conserva total_budget. Una cifra nueva o diferente lleva amount_reference_id=null y prevalece sobre la propuesta anterior. Una duda, negación de aportar dinero, condición no resuelta, aceptación parcial sin cifra o varios referentes posibles no confirman el importe entero: use amount_pending/amount=null, sin fabricar una asignación. No use precios del catálogo, cantidades del bot ni importes desconocidos como fondos del lead. Este contrato no autoriza financiamiento, reserva ni operaciones con una entidad.`

/** Build references exclusively from canonical conversation facts, never from
 * arbitrary history, catalogue prices or a model-supplied reference registry. */
export function confirmedMonetaryReferences(input: Row): Row[] {
  const summary = object(input.resumen), memory = object(summary._interpretation_memory)
  const amounts = object(summary._financing_amounts)
  const known = new Map<string, Row | null>()
  const add = (role: string, value: Row) => {
    if (typeof value.amount !== 'number' || !Number.isFinite(value.amount) || value.amount < 0
      || !text(value.evidence).trim() || value.confidence != null && !acceptedExtractorConfidence(value.confidence)) return
    const existing = known.get(role)
    if (known.has(role) && (!existing || existing.amount !== value.amount)) { known.set(role, null); return }
    known.set(role, { id: `confirmed:${role}:${value.amount}`, role, amount: value.amount,
      evidence: text(value.evidence).trim() })
  }
  for (const role of ['total_budget', 'down_payment', 'loan']) {
    if (object(memory.budget_revocation).role !== role) add(role, object(amounts[role]))
  }
  const budget = Object.hasOwn(memory, 'budget') ? object(memory.budget)
    : Object.keys(object(memory.budget_revocation)).length ? {} : object(object(summary._turn_intent).budget)
  if (acceptedExtractorConfidence(budget.confidence)) {
    const role = budget.status === 'maximum_total' ? 'total_budget' : budget.status === 'initial_capital' ? 'down_payment'
      : budget.status === 'amount' ? 'unclassified_budget' : ''
    if (role) add(role, budget)
  }
  return [...known.values()].filter((value): value is Row => !!value)
}

const currentEvidence = (evidence: unknown, current: string) => !!text(evidence).trim()
  && current.normalize('NFKC').toLowerCase().includes(text(evidence).trim().normalize('NFKC').toLowerCase())

/** The extractor owns reference meaning. Code validates only identity, amount
 * and current-source provenance; it never reparses the customer's quantity. */
export function resolvedMonetaryReference(statement: Row, current: string, references: Row[]): Row | null {
  if (typeof statement.amount_reference_id !== 'string' || !statement.amount_reference_id
    || typeof statement.amount !== 'number' || !Number.isFinite(statement.amount) || statement.amount < 0
    || !currentEvidence(statement.evidence, current)) return null
  const matches = references.filter(reference => reference.id === statement.amount_reference_id)
  return matches.length === 1 && matches[0].amount === statement.amount ? matches[0] : null
}

export function monetaryReferenceIssues(raw: Row, current: string, references: Row[]): string[] {
  const statements: [string, Row][] = [['budget', object(object(raw.turn_semantics).budget)],
    ...(Array.isArray(raw.financing_amounts) ? raw.financing_amounts.map((value, index): [string, Row] => [`financing_amounts.${index}`, object(value)]) : [])]
  const issues = statements.flatMap(([field, statement]) => statement.amount_reference_id != null
    && !resolvedMonetaryReference(statement, current, references) ? [`invalid_monetary_reference:${field}`] : [])
  const budget = statements[0][1]
  const role = budget.status === 'initial_capital' ? 'down_payment' : budget.status === 'maximum_total' ? 'total_budget' : ''
  // Two representations of the same evidenced monetary update must agree.
  // This compares typed values; it does not interpret the customer's wording.
  if (role && statements.slice(1).some(([, statement]) => statement.role === role
    && (budget.amount_reference_id != null || statement.amount_reference_id != null)
    && text(statement.evidence).trim() === text(budget.evidence).trim() && statement.amount !== budget.amount)) {
    issues.push('invalid_monetary_reference:budget')
  }
  return [...new Set(issues)]
}
