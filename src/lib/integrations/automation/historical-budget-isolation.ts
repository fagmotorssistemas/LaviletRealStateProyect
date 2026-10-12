import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { financingAmountStatements } from './financing-amounts'
import { reconcilePrimaryAfterBudgetIsolation } from './interpretation-consistency'
import { focusedNumericMentions } from './focused-numeric-syntax'
import { normalizeCatalogRequest } from './catalog-request'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const citation = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
const contained = (quote: unknown, source: unknown) => !!citation(quote) && citation(source).includes(citation(quote))
const monetaryIssues = new Set(['non_current_evidence:budget', 'missing_current_evidence:budget',
  'invalid_budget_amount', 'inconsistent_primary_intent:budget'])

/** A delta copied from an already accepted monetary declaration is not a new
 * budget. Source identity and a grounded independent current meaning prove
 * this before another model call. A changed amount, current role clarification,
 * withdrawal, uncertainty or unverified quote remains subject to recovery. */
export function reconcileConfirmedBudgetEcho(raw: Row, input: Row, current: string): { raw: Row; fields: string[] } {
  const semantics = object(raw.turn_semantics), budget = object(semantics.budget)
  const known = object(confirmedInterpretationMemory(object(input.resumen)).budget)
  const monetary = new Set(['amount', 'maximum_total', 'initial_capital'])
  // A bot quote can prove where an erroneous delta came from, but cannot
  // establish the amount or its role. Both remain backed by accepted memory.
  const historicalQuote = [...rows(input.historial), ...rows(input.historial_reciente)]
    .some(message => contained(budget.evidence, message.content))
    && focusedNumericMentions(text(budget.evidence)).some(mention => mention.value === known.amount)
  if (!monetary.has(text(budget.status)) || !monetary.has(text(known.status))
    || !acceptedExtractorConfidence(known.confidence) || typeof known.amount !== 'number' || known.amount <= 0
    || budget.amount !== known.amount || contained(budget.evidence, current)
    || !(contained(budget.evidence, known.evidence) || historicalQuote)) return { raw, fields: [] }
  // These are conservative vetoes, not vocabulary rules assigning a role.
  // A current monetary reference must be interpreted rather than dropped just
  // because the extractor also copied the old budget block.
  const value = current.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const catalog = normalizeCatalogRequest(raw.catalog_request, current)
  const currentPhysicalNumbers = [
    ...rows(catalog?.requirements).filter(requirement => requirement.field !== 'published_commercial_price')
      .flatMap(requirement => [requirement.value, requirement.upper_value]),
    ...rows(semantics.housing_quantities).filter(quantity => acceptedExtractorConfidence(quantity.confidence) && contained(quantity.evidence, current))
      .flatMap(quantity => Array.isArray(quantity.values) ? quantity.values : []),
    ...Object.entries(object(object(semantics.property).filters)).filter(([field]) =>
      contained(object(object(semantics.property).filter_evidence)[field], current))
      .flatMap(([, quantity]) => Array.isArray(quantity) ? quantity : [quantity]),
    ...(acceptedExtractorConfidence(object(semantics.property).confidence) && contained(object(semantics.property).evidence, current)
      ? (Array.isArray(object(semantics.property).unit_numbers) ? object(semantics.property).unit_numbers as unknown[] : []).map(Number) : []),
  ].filter((number): number is number => typeof number === 'number' && Number.isFinite(number))
  if (/\b(?:presupuest\w*|entrad\w*|capital|credito|prestamo|financ\w*|dolar\w*|dinero|monto|fondos|ahorros|invertir|inversion)\b|[$€£]/.test(value)
    || focusedNumericMentions(current).some(mention => mention.value === known.amount || !currentPhysicalNumbers.includes(mention.value))
    || financingAmountStatements(raw.financing_amounts, current).length
    || contained(object(raw.qualification).presupuesto_texto, current)) return { raw, fields: [] }

  const neutral: Row = { ...raw, turn_semantics: { ...semantics,
    budget: { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' } } }
  const independent = reconcilePrimaryAfterBudgetIsolation(neutral, current, object(input.pregunta_pendiente))
  if (!independent) return { raw, fields: [] }
  const fields = ['budget']
  if (semantics.primary_intent === 'discuss_budget'
    && semantics.primary_intent !== object(independent.turn_semantics).primary_intent) fields.push('primary_intent')
  // Other primary labels already have their own source and consistency checks.
  const result = semantics.primary_intent === 'discuss_budget' ? independent : neutral
  const qualification = { ...object(result.qualification) }
  if (!contained(qualification.presupuesto_texto, current)
    && contained(qualification.presupuesto_texto, known.evidence)) {
    qualification.presupuesto_texto = null
    fields.push('qualification.presupuesto_texto')
  }
  return { raw: { ...result, ...(Object.hasOwn(result, 'qualification') ? { qualification } : {}) }, fields }
}

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
  // This certificate discards a rejected monetary block during repair; it is
  // independent of admission of current high/medium extractor declarations.
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
