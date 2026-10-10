import { object, text, type Row } from './data'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { financingAmountStatements } from './financing-amounts'
import { reconcilePrimaryAfterBudgetIsolation } from './interpretation-consistency'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const citation = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
const contained = (quote: unknown, source: unknown) => !!citation(quote) && citation(source).includes(citation(quote))
const monetaryIssues = new Set(['non_current_evidence:budget', 'missing_current_evidence:budget',
  'invalid_budget_amount', 'inconsistent_primary_intent:budget'])

/** A repair must certify that the monetary block is reference context. A known
 * amount alone is not enough: its rejected quote must also belong to a saved
 * declaration or the actual history, and the current turn must assert no
 * monetary update. This removes an invalid delta, never a confirmed fact. */
export function isolateHistoricalBudget(previous: Row, merged: Row, repaired: Row,
  input: Row, current: string, remaining: string[], primaryRepairAllowed = false): Row | null {
  const primaryIssue = (issue: string) => primaryRepairAllowed
    && ['non_current_evidence:primary_intent', 'missing_current_evidence:primary_intent'].includes(issue)
  if (!remaining.length || remaining.some(issue => !monetaryIssues.has(issue) && !primaryIssue(issue))) return null
  const certificate = object(repaired.budget_turn_use)
  if (!['context_only', 'none'].includes(text(certificate.kind)) || certificate.confidence !== 'high'
    || !contained(certificate.evidence, current)) return null

  const summary = object(input.resumen), known = object(confirmedInterpretationMemory(summary).budget)
  const funds = object(summary._financing_amounts)
  const sources = [known.evidence, ...Object.values(funds).map(value => object(value).evidence),
    ...rows(input.historial || input.historial_reciente).map(message => message.content)]
  const knownAmounts = [known.amount, ...['total_budget', 'down_payment'].map(role => object(funds[role]).amount)]
    .filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount) && amount > 0)
  const originalBudget = object(object(previous.turn_semantics).budget)
  const provesHistoricalBudget = (budget: Row) => !contained(budget.evidence, current)
    && sources.some(source => contained(budget.evidence, source))
    && (typeof budget.amount === 'number' ? knownAmounts.includes(budget.amount)
      : budget.amount == null && budget.status === known.status && contained(budget.evidence, known.evidence))
  const labelOnly = remaining.every(issue => issue === 'inconsistent_primary_intent:budget' || primaryIssue(issue))
    && (!originalBudget.status || originalBudget.status === 'not_discussed') && originalBudget.amount == null
  if (!labelOnly && !provesHistoricalBudget(originalBudget)) return null

  for (const raw of [previous, merged, repaired]) {
    const budget = object(object(raw.turn_semantics).budget)
    // A new amount, ambiguity, refusal or role withdrawal is genuine current
    // meaning even when the model's other fields still need repair.
    if (budget.status && budget.status !== 'not_discussed' && contained(budget.evidence, current)
      || financingAmountStatements(raw.financing_amounts, current).length
      || contained(object(raw.qualification).presupuesto_texto, current)) return null
    if (raw !== repaired && budget.status && budget.status !== 'not_discussed'
      && !provesHistoricalBudget(budget)) return null
  }

  const neutral: Row = { ...merged, financing_amounts: [],
    qualification: { ...object(merged.qualification), presupuesto_texto: null },
    turn_semantics: { ...object(merged.turn_semantics),
      budget: { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' } } }
  // The fallback has the same field ownership as the focused repair. A model
  // returning extra primary fields cannot replace a valid current intention.
  if (!primaryRepairAllowed) return object(neutral.turn_semantics).primary_intent === 'discuss_budget' ? null : neutral
  return reconcilePrimaryAfterBudgetIsolation(neutral, current, object(input.pregunta_pendiente), repaired)
}
