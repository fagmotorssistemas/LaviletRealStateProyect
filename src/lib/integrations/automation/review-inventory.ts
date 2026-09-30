import { object, text, type Row } from './data'
import { factUnits } from './structured-facts'

export function sentenceInventorySchema(schema: Row, sentences: Row[]): Row {
  const ids = sentences.map(row => text(row.id))
  return { ...schema, properties: { ...object(schema.properties), sentence_inventory: {
    type: 'array', minItems: ids.length, maxItems: ids.length, items: { type: 'object', additionalProperties: false,
      properties: { sentence_id: { type: 'string', enum: ids.length ? ids : ['none'] },
        catalog_fields: { type: 'array', maxItems: Object.keys(factUnits).length, items: { type: 'string', enum: Object.keys(factUnits) } },
        project_quantities: { type: 'boolean' }, business_facts: { type: 'boolean' } },
      required: ['sentence_id', 'catalog_fields', 'project_quantities', 'business_facts'] } } },
    required: [...new Set([...(schema.required as string[]), 'sentence_inventory'])] }
}

/** Checks the reviewer's inventory, never interprets the customer's prose.
 * Existing historical fixtures use the older global inventory contract. */
export function sentenceInventoryIssues(review: Row, sentences: Row[]): Row[] {
  if (review.sentence_inventory === undefined) return []
  if (!Array.isArray(review.sentence_inventory)) return [{ code: 'invalid_sentence_inventory', kind: 'review_metadata' }]
  const inventory = review.sentence_inventory.map(object)
  const rows = (key: string) => Array.isArray(review[key]) ? (review[key] as unknown[]).map(object) : []
  const issues: Row[] = []
  for (const sentence of sentences) {
    const matches = inventory.filter(row => row.sentence_id === sentence.id), entry = matches[0]
    const fail = (code: string, field?: string) => issues.push({ code, kind: 'review_metadata', sentence_id: sentence.id, field })
    if (matches.length !== 1 || !Array.isArray(entry?.catalog_fields)
      || typeof entry.project_quantities !== 'boolean' || typeof entry.business_facts !== 'boolean') {
      fail('incomplete_sentence_inventory'); continue
    }
    for (const field of entry.catalog_fields) {
      if (typeof field !== 'string' || !Object.hasOwn(factUnits, field)) { fail('invalid_sentence_field'); continue }
      if (!rows('factual_values').some(fact => fact.fragment === sentence.text && fact.field === field)) fail('sentence_fact_not_reviewed', field)
    }
    if (entry.project_quantities && !rows('project_values').some(fact => fact.fragment === sentence.text)) fail('sentence_quantity_not_reviewed')
    if (entry.business_facts && !rows('claims').some(claim => claim.fragment === sentence.text
      && ['project_fact', 'operational_fact'].includes(text(claim.claim_kind)))) fail('sentence_claim_not_reviewed')
  }
  if (inventory.some(row => !sentences.some(sentence => sentence.id === row.sentence_id)))
    issues.push({ code: 'unknown_inventory_sentence', kind: 'review_metadata' })
  return issues
}

export const SENTENCE_INVENTORY_RULES = `COBERTURA DE LA REVISIÓN: complete sentence_inventory para CADA ID de oraciones_borrador, exactamente una vez. Lea cada oración y enumere catalog_fields realmente afirmados (incluidos valores escritos en palabras, como plantas), project_quantities si afirma cantidades generales del proyecto y business_facts si afirma hechos o gestiones comerciales. Cada campo indicado necesita su fila correspondiente en factual_values; las cantidades, en project_values; los hechos comerciales, en claims. Una oración puede contener varios hechos: verificar el precio no verifica su planta ni su superficie. Una pregunta, cortesía u orientación puede tener catalog_fields=[] y los indicadores false. No copie atributos ausentes del texto para rellenar filas ni oculte una afirmación real para hacer pasar la ficha. Si un hecho carece de fuente, indíquelo en claims/review_issues; no lo apruebe. El sistema comprueba la coherencia del inventario y los datos; usted interpreta la redacción.`
