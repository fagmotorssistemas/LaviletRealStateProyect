import { object, text, type Row } from './data'
import { financingAmountStatements } from './financing-amounts'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const pick = (row: Row, keys: string[]) => Object.fromEntries(keys.map(key => [key, row[key] ?? null]))
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const literal = (quote: unknown, source: unknown) => !!text(quote).trim()
  && text(source).normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())
const quantityFields = ['dimension', 'values', 'role', 'count_basis']
const propertyFields = ['group', 'category', 'excluded_categories', 'filters']
const validBudget = (budget: Row) => budget.status && budget.status !== 'not_discussed' && budget.confidence === 'high'
  && text(budget.evidence).trim() && (!['amount', 'maximum_total', 'initial_capital'].includes(text(budget.status))
    || typeof budget.amount === 'number' && Number.isFinite(budget.amount) && budget.amount > 0)
const propertyValue = (row: Row): Row => ({ ...pick(row, propertyFields),
  excluded_categories: Array.isArray(row.excluded_categories) ? row.excluded_categories : [],
  filters: Object.fromEntries(Object.entries(object(row.filters)).filter(([, value]) => value !== null && value !== undefined
    && (!Array.isArray(value) || value.length > 0))) })

/** Only accepted declarations are durable facts. Old messages and bot replies
 * are not an alternative source from which to infer new values or permissions. */
export function confirmedInterpretationMemory(summary: Row): Row {
  const saved = object(summary._interpretation_memory)
  // Support conversations created before this memory existed. The last turn
  // contract already contains a validated budget with its original evidence.
  const hasSavedBudget = Object.hasOwn(saved, 'budget')
  const withdrawn = Object.keys(object(saved.budget_revocation)).length > 0
  let budget = hasSavedBudget ? object(saved.budget) : withdrawn ? {} : object(object(summary._turn_intent).budget)
  // Older conversations may retain the accepted monetary role without a turn
  // budget. A single evidenced funds declaration can supply that memory; loans,
  // competing roles and explicit withdrawals cannot establish a new budget.
  if (!hasSavedBudget && !withdrawn && !validBudget(budget)) {
    const amounts = object(summary._financing_amounts)
    const funds = ['total_budget', 'down_payment'].filter(role => {
      const amount = object(amounts[role])
      return typeof amount.amount === 'number' && Number.isFinite(amount.amount) && amount.amount > 0
        && !!text(amount.evidence).trim()
    })
    if (funds.length === 1) {
      const amount = object(amounts[funds[0]])
      budget = { status: funds[0] === 'total_budget' ? 'maximum_total' : 'initial_capital',
        amount: amount.amount, evidence: amount.evidence, confidence: 'high' }
    }
  }
  const result = { ...saved }
  delete result.budget
  return { ...result, ...(validBudget(budget) ? { budget } : {}) }
}

export function rememberInterpretationFacts(summary: Row, current: string, extracted: Row, semantics: Row): Row {
  const memory = { ...confirmedInterpretationMemory(summary) }
  const budget = object(semantics.budget), property = object(semantics.property)
  const statements = financingAmountStatements(semantics.financing_amounts || extracted.financing_amounts, current)
  const previousBudget = object(memory.budget)
  const previousRole = previousBudget.status === 'initial_capital' ? 'down_payment'
    : previousBudget.status === 'maximum_total' ? 'total_budget' : ''
  const revoked = statements.find(statement => statement.replaces_role === previousRole)
  if (previousRole && revoked) {
    // A current semantic correction invalidates only the corresponding saved
    // declaration. The marker also prevents an old CRM amount resurrecting it.
    memory.budget = {}
    memory.budget_revocation = { role: previousRole, evidence: revoked.evidence }
    const qualified = { ...object(memory.qualification) }
    if (literal(qualified.presupuesto_texto, previousBudget.evidence) || literal(previousBudget.evidence, qualified.presupuesto_texto)) {
      delete qualified.presupuesto_texto
      if (Object.keys(qualified).length) memory.qualification = qualified
      else delete memory.qualification
    }
  }
  if (validBudget(budget) && literal(budget.evidence, current)) {
    memory.budget = { ...pick(budget, ['status', 'amount', 'evidence']), confidence: 'high' }
    delete memory.budget_revocation
  }
  const propertyHasValues = property.group || property.category || (Array.isArray(property.excluded_categories) && property.excluded_categories.length)
    || Object.keys(object(propertyValue(property).filters)).length
  if (propertyHasValues && property.confidence === 'high' && literal(property.evidence, current)) {
    // This is the last declaration, not a reusable search/select operation.
    memory.property = { ...pick(property, [...propertyFields, 'evidence']), confidence: 'high' }
  }
  const quantities = rows(semantics.housing_quantities).filter(row => row.confidence === 'high' && literal(row.evidence, current))
  if (quantities.length) {
    const domains = new Set(quantities.map(row => `${row.dimension}:${row.role}`))
    memory.housing_quantities = [...rows(memory.housing_quantities).filter(row => !domains.has(`${row.dimension}:${row.role}`)),
      ...quantities.map(row => pick(row, [...quantityFields, 'evidence', 'confidence']))]
  }
  const qualification = { ...object(memory.qualification) }
  for (const [key, value] of Object.entries(object(extracted.qualification))) if (literal(value, current)) qualification[key] = value
  if (Object.keys(qualification).length) memory.qualification = qualification
  return memory
}

/** Remove only proven echoes of accepted facts from this turn's updates. Never
 * promote history to current evidence, discard a changed value, or reuse consent. */
export function reconcileHistoricalInterpretation(raw: Row, current: string, summary: Row): { raw: Row; fields: string[] } {
  const known = confirmedInterpretationMemory(summary), semantics = { ...object(raw.turn_semantics) }
  const fields: string[] = []
  const repeated = (proposed: Row, previous: Row, keys: string[]) => previous.confidence === 'high'
    && !literal(proposed.evidence, current) && literal(proposed.evidence, previous.evidence)
    && equal(pick(proposed, keys), pick(previous, keys))
  const budget = object(semantics.budget)
  // A current budget intent with historical evidence is a real unresolved
  // interpretation, not permission to discard the customer's new budget.
  if (semantics.primary_intent !== 'discuss_budget' && budget.status !== 'not_discussed'
    && repeated(budget, object(known.budget), ['status', 'amount'])) {
    semantics.budget = { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' }
    fields.push('budget')
  }
  if (Array.isArray(semantics.housing_quantities)) semantics.housing_quantities = rows(semantics.housing_quantities).filter((quantity, index) => {
    if (!rows(known.housing_quantities).some(previous => repeated(quantity, previous, quantityFields))) return true
    fields.push(`housing_quantities.${index}`)
    return false
  })
  const property = object(semantics.property)
  if (property.operation === 'none' && property.reference_kind === 'none'
    && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length) && !property.selector && !property.query_scope
    && repeated(property, object(known.property), ['group', 'category'])
    && equal(propertyValue(property), propertyValue(object(known.property)))) {
    semantics.property = { ...property, group: null, category: null, excluded_categories: [],
      filters: Object.fromEntries(Object.keys(object(property.filters)).map(key => [key, Array.isArray(object(property.filters)[key]) ? [] : null])),
      filter_evidence: Object.fromEntries(Object.keys(object(property.filter_evidence)).map(key => [key, ''])), evidence: '', confidence: 'low' }
    fields.push('property')
  }
  const qualification = { ...object(raw.qualification) }
  for (const [key, value] of Object.entries(qualification)) {
    if (!literal(value, current) && text(value).trim() && value === object(known.qualification)[key]) {
      qualification[key] = null
      fields.push(`qualification.${key}`)
    }
  }
  // The legacy budget contract predates saved qualification citations.
  if (fields.includes('budget') && !literal(qualification.presupuesto_texto, current)
    && literal(qualification.presupuesto_texto, object(known.budget).evidence)) {
    qualification.presupuesto_texto = null
    fields.push('qualification.presupuesto_texto')
  }
  return { raw: { ...raw, ...(Object.hasOwn(raw, 'turn_semantics') ? { turn_semantics: semantics } : {}),
    ...(Object.hasOwn(raw, 'qualification') ? { qualification } : {}) }, fields }
}
