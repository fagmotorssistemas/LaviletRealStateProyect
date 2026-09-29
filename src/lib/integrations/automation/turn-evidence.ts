import { object, text, type Row } from './data'
import { projectQuantityEvidence } from './project-quantities'
import { decimalNumber } from './numeric-relations'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const fields = ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number', 'published_commercial_price']

/** One immutable, scoped source for writer, reviewer and deterministic checks. */
export function turnEvidence(verified: Row, audit: Row = {}) {
  const sources = audit.verified_catalog === true
    ? [{ source: 'query', units: rows(object(audit.catalog_results).units) },
      { source: 'alternatives', units: rows(object(audit.alternative_results).units) }]
    : [{ source: 'context', units: rows(verified.catalogo) }]
  const byId = new Map<string, Row>()
  const conflicts: Row[] = []
  for (const { source, units } of sources) for (const unit of units) {
    const id = text(unit.id)
    if (!id) continue
    const previous = byId.get(id)
    if (previous && fields.some(field => previous[field] != null && unit[field] != null && previous[field] !== unit[field])) {
      conflicts.push({ code: 'conflicting_evidence', unit_id: id, kind: 'system_evidence' }); continue
    }
    byId.set(id, { ...previous, ...unit, evidence_sources: [...new Set([...(Array.isArray(previous?.evidence_sources) ? previous.evidence_sources : []), source])] })
  }
  const units = [...byId.values()]
  const groups: Row[] = []
  for (const key of new Set(units.map(unit => `${text(unit.category)}:${unit.bedrooms ?? 'unknown'}`))) {
    const members = units.filter(unit => `${text(unit.category)}:${unit.bedrooms ?? 'unknown'}` === key)
    for (const aggregation of ['min', 'max'] as const) {
      const values: Row = {}
      for (const field of fields) if (members.every(unit => unit[field] != null && unit[field] !== '' && Number.isFinite(Number(unit[field]))))
        values[field] = Math[aggregation](...members.map(unit => Number(unit[field])))
      groups.push({ id: `group:${key}:${aggregation}`, category: members[0].category, aggregation,
        member_ids: members.map(unit => unit.id), ...values })
    }
  }
  return { version: 'turn-evidence-v2', units, groups, conflicts, project_facts: projectQuantityEvidence(verified),
    query: audit.catalog_query || null, query_result_ids: object(audit.catalog_results).unit_ids || [],
    alternative_query: object(audit.alternative_results).query || null,
    alternative_ids: object(audit.alternative_results).unit_ids || [] }
}

export function replyReferences(reply: string) {
  return reply.split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean)
    .map((value, index) => ({ id: `S${index + 1}`, text: value }))
}

/** Resolve only references that identify one sentence of the actual draft. Never change a value. */
export function normalizeReviewReferences(review: Row, units: Row[], reply: string) {
  const corrections: Row[] = []
  const sentences = replyReferences(reply)
  const resolveFragment = (item: Row): Row => {
    let sentence = sentences.find(sentence => sentence.id === item.fragment)
    if (!sentence && /\.{3}|…/.test(text(item.fragment))) {
      const parts = text(item.fragment).split(/\.{3}|…/).map(part => part.trim()).filter(Boolean)
      if (parts.length >= 2 && parts.every(part => part.length >= 4)) {
        const matches = sentences.filter(candidate => {
          let offset = 0
          return parts.every(part => {
            const index = candidate.text.indexOf(part, offset)
            if (index < 0) return false
            offset = index + part.length
            return true
          })
        })
        if (matches.length === 1) {
          sentence = matches[0]
          corrections.push({ code: 'abbreviated_sentence_reference_resolved', from: text(item.fragment), to: sentence.id })
        }
      }
    }
    // The reviewer may paraphrase the prose. A unique occurrence of the exact
    // numeric value in the draft is a code-owned reference, independent of word order.
    const fragmentNumbers = [...text(item.fragment).matchAll(/\d[\d.,]*/g)].map(match => decimalNumber(match[0]))
    if (!sentence && typeof item.value === 'number' && Number.isFinite(item.value)
      && (!fragmentNumbers.length || fragmentNumbers.includes(item.value))) {
      const includesValue = (candidate: string, value: number) => [...candidate.matchAll(/\d[\d.,]*/g)]
        .some(match => decimalNumber(match[0]) === value)
      const matches = sentences.filter(candidate => fragmentNumbers.every(value => includesValue(candidate.text, value))
        && includesValue(candidate.text, item.value as number)
        && (item.operator !== 'between' || typeof item.upper_value === 'number'
          && includesValue(candidate.text, item.upper_value)))
      if (matches.length === 1) {
        sentence = matches[0]
        corrections.push({ code: 'unique_numeric_sentence_reference_resolved', from: text(item.fragment), to: sentence.id })
      }
    }
    if (sentence && sentence.id === item.fragment) corrections.push({ code: 'sentence_reference_resolved', from: sentence.id })
    return sentence ? { ...item, fragment: sentence.text } : { ...item }
  }
  const facts = Array.isArray(review.factual_values) ? review.factual_values.map(raw => {
    const fact = resolveFragment(object(raw))
    if (!units.some(unit => unit.id === fact.unit_id)) {
      const matches = units.filter(unit => unit.unit_number != null && text(unit.unit_number) === text(fact.unit_id))
      if (matches.length === 1) {
        corrections.push({ code: 'unit_number_resolved', from: fact.unit_id, to: matches[0].id })
        fact.unit_id = matches[0].id
      }
    }
    return fact
  }) : review.factual_values
  return { review: { ...review, factual_values: facts,
    claims: Array.isArray(review.claims) ? review.claims.map(raw => resolveFragment(object(raw))) : review.claims }, corrections }
}
