import { object, text, type Row } from './data'
import { derivedFactualValueSchema, derivedCalculationIssues, CONTEXTUAL_CALCULATION_REVIEW_RULES } from './semantic-review'
import type { ContextualReasoningEvidence } from './contextual-reasoning'
import { satisfiesNumeric } from './numeric-relations'
import { DISCOUNT_NUMBER_FIELDS, DISCOUNT_FACT_UNITS, DISCOUNT_REFERENCE_RULES, discountReferenceEvidence } from './discount-evidence'

export const factUnits: Record<string, string> = { bedrooms: 'count', bathrooms_full: 'count',
  area_internal_m2: 'm2', area_exterior_m2: 'm2', published_commercial_price: 'USD', floor_number: 'floor', ...DISCOUNT_FACT_UNITS }

/** A range may be cited for one of its exact endpoints by an older reviewer.
 * Resolve only the reference, within the identical set, never the value/prose. */
export function normalizeStructuredFacts(input: unknown, catalog: Row[]) {
  const corrections: Row[] = []
  if (!Array.isArray(input)) return { facts: input, corrections }
  const facts = input.map(raw => {
    const fact = object(raw), source = catalog.find(row => row.id === fact.unit_id)
    if (source?.aggregation !== 'range' || fact.upper_value != null || typeof fact.value !== 'number') return raw
    const field = text(fact.field), lower = source[field], upper = object(source.upper_values)[field]
    const endpoint = fact.operator === 'gte' && fact.value === lower ? 'min'
      : fact.operator === 'lte' && fact.value === upper ? 'max'
        : fact.operator === 'eq' && lower === upper && fact.value === lower ? 'min' : null
    if (!endpoint || !Array.isArray(source.member_ids) || !source.member_ids.length) return raw
    const members = [...source.member_ids].sort()
    const matches = catalog.filter(row => row.aggregation === endpoint && row[field] === fact.value
      && ['category', 'bedrooms_filter', 'source_scope', 'covers'].every(key => row[key] === source[key])
      && Array.isArray(row.member_ids) && JSON.stringify([...row.member_ids].sort()) === JSON.stringify(members))
    if (matches.length !== 1) return raw
    corrections.push({ code: 'range_endpoint_reference_resolved', from: fact.unit_id, to: matches[0].id,
      field, value: fact.value, operator: fact.operator })
    return { ...fact, unit_id: matches[0].id }
  })
  return { facts, corrections }
}

/** Compare published facts to authoritative data. Derived results additionally
 * need a grounded calculation and the stated quantity in the actual draft. */
export function structuredFactIssues(input: unknown, catalog: Row[], reasoningEvidence?: ContextualReasoningEvidence, reply = ''): Row[] {
  if (!Array.isArray(input) || input.length > 80) return [{ code: 'invalid_fact_list', kind: 'review_metadata' }]
  return (normalizeStructuredFacts(input, catalog).facts as unknown[]).flatMap(raw => {
    const fact: Row = { operator: 'eq', ...object(raw) }, source = catalog.find(row => row.id === fact.unit_id), field = text(fact.field)
    if (field === 'derived_value') return derivedCalculationIssues(fact, reply, reasoningEvidence)
    const fail = (code: string, kind = 'review_metadata') => [{ code, kind, unit_id: fact.unit_id, field,
      received: fact.value, received_upper: fact.upper_value ?? null, operator: fact.operator,
      expected: source?.[field] ?? null, expected_upper: object(source?.upper_values)[field] ?? null,
      subject_category: fact.subject_category ?? null, fragment: fact.fragment }]
    if (!source || !factUnits[field] || typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return fail('invalid_unit_fact')
    const discountField = DISCOUNT_NUMBER_FIELDS.find(key => key === field)
    const discount = discountField ? discountReferenceEvidence(source) : null
    if (discount && !discount.available) return fail('discount_reference_unavailable', 'catalog_data')
    if (fact.measurement_unit != null && fact.measurement_unit !== factUnits[field]) return fail('numeric_unit_mismatch')
    if (!['eq', 'gt', 'gte', 'lt', 'lte', 'between'].includes(text(fact.operator))) return fail('invalid_numeric_operator')
    if (fact.operator === 'between' ? typeof fact.upper_value !== 'number' || !Number.isFinite(fact.upper_value)
      || fact.upper_value < fact.value : fact.upper_value != null) return fail('invalid_numeric_bounds')
    const expected = discountField ? discount!.values[discountField] : source[field]
    if (typeof expected !== 'number' || !Number.isFinite(expected)) return fail('catalog_value_unavailable', 'catalog_data')
    if (source.aggregation === 'range') {
      if (fact.operator !== 'between') return fail('range_reference_requires_interval')
      if (fact.value !== expected || fact.upper_value !== object(source.upper_values)[field]) return fail('catalog_range_mismatch', 'catalog_data')
    } else {
      if (source.aggregation === 'min' && !['eq', 'gte'].includes(text(fact.operator))
        || source.aggregation === 'max' && !['eq', 'lte'].includes(text(fact.operator))) return fail('aggregate_operator_mismatch')
      // Structured business values are exact. The tolerance retained by legacy
      // prose helpers must never permit rounding an interpreted catalogue fact.
      const matches = fact.operator === 'eq' ? expected === fact.value
        : satisfiesNumeric(expected, fact.value, fact.operator, fact.upper_value)
      if ((source.aggregation && fact.value !== expected)
        || !matches) return fail('catalog_value_mismatch', 'catalog_data')
    }
    return []
  })
}

export function structuredProjectIssues(input: unknown, sources: Row[]): Row[] {
  if (!Array.isArray(input)) return [{ code: 'invalid_project_fact_list', kind: 'review_metadata' }]
  return input.flatMap(raw => {
    const fact = object(raw), source = sources.find(row => row.id === fact.source_id)
    return source && typeof fact.value === 'number' && Number.isFinite(fact.value)
      && fact.value === source.value && fact.dimension === source.dimension && fact.measurement_unit === source.unit ? []
      : [{ code: 'project_quantity_mismatch', kind: source ? 'catalog_data' : 'review_metadata',
        fragment: fact.fragment, source_id: fact.source_id, received: fact.value, expected: source?.value ?? null }]
  })
}

export function structuredReviewSchema(schema: Row, sentenceIds: string[], catalog: Row[], projectFacts: Row[]): Row {
  const properties = { ...object(schema.properties) }, list = object(properties.factual_values)
  const old = object(object(list.items).anyOf instanceof Array ? (object(list.items).anyOf as Row[])[0] : list.items)
  const factProperties = { ...object(old.properties), fragment: { type: 'string', enum: sentenceIds },
    field: { type: 'string', enum: Object.keys(factUnits) },
    unit_id: { type: 'string', enum: catalog.length ? catalog.map(row => text(row.id)) : ['none'] },
    value: { type: 'number' }, measurement_unit: { type: 'string', enum: [...new Set(Object.values(factUnits))] } }
  // Interpretation of quantities, units and comparisons belongs to the reviewer.
  const variants: Row[] = []
  for (const [aggregation, operators, interval] of [
    ['', ['eq', 'gt', 'gte', 'lt', 'lte'], false], ['', ['between'], true],
    ['min', ['eq', 'gte'], false], ['max', ['eq', 'lte'], false], ['range', ['between'], true],
  ] as const) {
    const ids = catalog.filter(row => (row.aggregation || '') === aggregation).map(row => text(row.id))
    if (!ids.length) continue
    variants.push({ type: 'object', additionalProperties: false,
      properties: { ...factProperties, unit_id: { type: 'string', enum: ids },
        operator: { type: 'string', enum: operators }, upper_value: { type: interval ? 'number' : 'null' } },
      required: [...new Set([...Object.keys(factProperties), 'operator', 'upper_value'])] })
  }
  variants.push(derivedFactualValueSchema(sentenceIds))
  properties.factual_values = { type: 'array', maxItems: variants.length && sentenceIds.length ? 80 : 0,
    items: { anyOf: variants.length ? variants : [{ type: 'object', properties: {}, required: [], additionalProperties: false }] } }
  properties.project_values = { type: 'array', maxItems: projectFacts.length ? 40 : 0, items: { type: 'object', additionalProperties: false,
    properties: { fragment: { type: 'string', enum: sentenceIds.length ? sentenceIds : ['none'] },
      source_id: { type: 'string', enum: projectFacts.length ? projectFacts.map(row => text(row.id)) : ['none'] },
      dimension: { type: 'string' }, measurement_unit: { type: 'string' }, value: { type: 'number' } },
    required: ['fragment', 'source_id', 'dimension', 'measurement_unit', 'value'] } }
  properties.factual_inventory_complete = { type: 'boolean' }
  return { ...schema, properties, required: [...new Set([...(schema.required as string[]), 'project_values', 'factual_inventory_complete'])] }
}

export const STRUCTURED_FACT_RULES = `CONTRATO DE HECHOS ESTRUCTURADOS: Usted interpreta el borrador completo. El sistema NO extrae ni interpreta sus cifras, palabras, unidades de medida ni comparaciones. En factual_values enumere todos los hechos numéricos atribuidos a unidades o grupos y seleccione unidad/grupo, atributo, valor exacto, operador y measurement_unit (m2, USD, count o floor). Interprete números escritos con palabras y representaciones equivalentes. Convierta unidades solo cuando sean inequívocas y exactas; nunca redondee. No copie cifras de la fuente que no estén afirmadas en el borrador. En project_values incluya las cantidades del proyecto respaldadas por evidencia_turno.project_facts con source_id, dimension, measurement_unit y valor normalizado de esa fuente. Si falta una fuente, rechace la afirmación en claims/review_issues, no la omita silenciosamente. Use [] cuando no corresponda. factual_inventory_complete=true SOLO después de revisar todas las oraciones y comprobar que no omitió hechos. La cobertura, atribución y significado son responsabilidad suya; el sistema compara exclusivamente los campos estructurados con sus fuentes. Al reparar su ficha, vuelva a extraer desde el MISMO borrador, sin cambiarlo ni conservar filas que usted haya atribuido por error.`
  + '\nREFERENCIAS NUMÉRICAS: un grupo min sirve para su mínimo exacto (eq o gte); max para su máximo exacto (eq o lte); range para el intervalo completo (between, value y upper_value). Para extremos de categorías o tamaños distintos use cada grupo min/max correspondiente; no los una en un rango de una categoría diferente. Aunque ambos extremos coincidan, un grupo range representa un intervalo. El esquema separa estas referencias; una referencia incompatible es un defecto de ficha, no prueba de que la cifra del borrador sea falsa.'
  + '\n' + DISCOUNT_REFERENCE_RULES + '\n' + CONTEXTUAL_CALCULATION_REVIEW_RULES
