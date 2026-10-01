import { object, text, type Row } from './data'
import { focusedNumericMentions } from './focused-numeric-syntax'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Numeric evidence only: the reviewer cannot substitute catalogue quantities
 * for the draft. Exact distance/time conversions use the same dimensional
 * normalizer as the authoritative project evidence. */
export function observedNumericIssues(review: Row, sentences: Row[]): Row[] {
  return ['factual_values', 'project_values'].flatMap(key => rows(review[key]).flatMap(fact => {
    const sentence = sentences.find(row => row.id === fact.fragment || row.text === fact.fragment)
    if (!sentence) return []
    const mentions = focusedNumericMentions(text(sentence.text))
    const values = mentions.map(row => row.value)
    const quantities = key === 'project_values' ? mentions.flatMap(row => row.quantities) : []
    const converted = quantities.filter(row => row.dimension === fact.dimension && row.unit === fact.measurement_unit).map(row => row.value)
    // Once a quantity has an explicit unit, its raw numeral cannot stand in for
    // a different unit (500 km is not 500 m, even though both contain "500").
    const observed = [...new Set(quantities.length ? converted : values)]
    const asserted = fact.operator === 'between' ? [fact.value, fact.upper_value] : [fact.value]
    return asserted.every(value => typeof value === 'number' && observed.includes(value)) ? [] : [{
      code: 'review_number_not_in_draft', kind: 'review_metadata', sentence_id: sentence.id, fragment: sentence.text,
      field: fact.field || fact.dimension, received: fact.value, observed_values: observed,
      owner: 'system', repair_owner: 'reviewer', reason: 'La ficha numérica contiene valores que no corresponden a las cantidades expresadas en esta oración. Reextraiga desde el borrador sin copiar cifras del catálogo.',
    }]
  }))
}
