// Deterministic fixture oracle. This grades known fixture assertions, never
// interprets live customer prose and is not imported by production validators.
const rows = value => Array.isArray(value) ? value : []
function reviewFidelity(expected, review, observations) {
  if (!expected) return { status: 'not_required', issues: [] }
  const first = observations.find(o => o.request_kind === 'review') || observations[0] || {}
  const sentences = rows(first.sentence_references)
  const sources = rows(first.source_references)
  const catalog = rows(first.catalog_references)
  const sentenceId = fragment => sentences.find(s => s.id === fragment || s.text === fragment)?.id
  const issues = []
  for (const expectation of rows(expected.claims)) {
    const claims = rows(review.claims).filter(c => sentenceId(c.fragment) === expectation.sentence_id)
    if (expectation.exclusive_kind && claims.some(c => c.claim_kind !== expectation.claim_kind))
      issues.push({ code: 'oracle_wrong_claim_kind', sentence_id: expectation.sentence_id, expected: expectation.claim_kind,
        received: claims.map(c => c.claim_kind) })
    const valid = claims.some(c => c.claim_kind === expectation.claim_kind && c.verdict === 'supported'
      && c.evidence_source === expectation.evidence_source && rows(c.evidence_ids).some(id => sources.some(source =>
        source.id === id && source.kind === expectation.claim_kind
        && expectation.source_paths.some(path => source.path === path || source.path?.startsWith(path + '.')))))
    if (!valid) issues.push({ code: 'oracle_required_source_not_verified', sentence_id: expectation.sentence_id,
      claim_kind: expectation.claim_kind, source_paths: expectation.source_paths })
  }
  const matches = (fact, expectation) => sentenceId(fact.fragment) === expectation.sentence_id
    && fact.field === expectation.field && (expectation.value === undefined || fact.value === expectation.value)
    && (expectation.operator === undefined || fact.operator === expectation.operator)
    && (expectation.value_scope === undefined || fact.value_scope === expectation.value_scope)
    && catalog.some(source => (source.id === fact.unit_id || source.canonical_id === fact.unit_id || source.unit_number === fact.unit_id)
      && (!expectation.unit_number || source.unit_number === expectation.unit_number)
      && (!expectation.category || source.category === expectation.category)
      && (!expectation.member_ids || JSON.stringify([...rows(source.member_ids)].sort()) === JSON.stringify([...expectation.member_ids].sort())))
  const coversEveryMember = expectation => {
    if (expectation.value_scope !== 'each_member' || !rows(expectation.member_ids).length) return false
    const basic = { ...expectation, value_scope: undefined, member_ids: undefined }
    const members = new Set()
    for (const fact of rows(review.factual_values).filter(fact => matches(fact, basic))) {
      const source = catalog.find(source => source.id === fact.unit_id || source.canonical_id === fact.unit_id || source.unit_number === fact.unit_id)
      // A complete set of individual checks is equivalent to checking every
      // member of a group. A minimum/maximum/summary alone never proves this.
      if (fact.value_scope === 'individual' && source && !source.aggregation && !Array.isArray(source.member_ids))
        members.add(source.canonical_id || source.id)
      else if (fact.value_scope === 'each_member' && source?.aggregation)
        rows(source.member_ids).forEach(id => members.add(id))
    }
    return JSON.stringify([...members].sort()) === JSON.stringify([...new Set(expectation.member_ids)].sort())
  }
  for (const expectation of rows(expected.facts))
    if (!rows(review.factual_values).some(fact => matches(fact, expectation)) && !coversEveryMember(expectation))
      issues.push({ code: 'oracle_required_numeric_assertion_missing', ...expectation })
  for (const expectation of rows(expected.ranges)) {
    const facts = rows(review.factual_values).filter(fact => matches(fact, expectation))
    const between = facts.some(fact => fact.operator === 'between' && fact.value === expectation.lower && fact.upper_value === expectation.upper)
    const source = fact => catalog.find(row => row.id === fact.unit_id || row.canonical_id === fact.unit_id)
    const sameSet = (lower, upper) => {
      if (!lower || !upper || lower.category !== upper.category) return false
      if (Array.isArray(lower.member_ids) && Array.isArray(upper.member_ids))
        return lower.member_ids.length > 0 && JSON.stringify([...lower.member_ids].sort()) === JSON.stringify([...upper.member_ids].sort())
      // Older saved reports omitted memberships but preserved code-owned group
      // identifiers. A min/max pair from that identical group is still exact;
      // unrelated group IDs never qualify on category alone.
      return String(lower.id).replace(/:min$/, '') === String(upper.id).replace(/:max$/, '')
    }
    const lower = facts.filter(fact => ['eq', 'gte'].includes(fact.operator) && fact.value === expectation.lower && source(fact)?.aggregation === 'min')
    const upper = facts.filter(fact => ['eq', 'lte'].includes(fact.operator) && fact.value === expectation.upper && source(fact)?.aggregation === 'max')
    const endpoints = lower.some(lo => upper.some(hi => sameSet(source(lo), source(hi))))
    if (!between && !endpoints) issues.push({ code: 'oracle_required_range_missing', ...expectation })
  }
  return { status: issues.length ? 'failed' : 'passed', issues }
}
module.exports = { reviewFidelity }
