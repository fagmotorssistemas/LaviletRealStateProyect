import { object, text, type Row } from './data'
import { satisfiesNumeric } from './numeric-relations'

export const factUnits: Record<string, string> = { bedrooms: 'count', bathrooms_full: 'count',
  area_internal_m2: 'm2', area_exterior_m2: 'm2', published_commercial_price: 'USD', floor_number: 'floor' }

/** No draft, vocabulary or regular expressions: compare interpreted facts to authoritative data. */
export function structuredFactIssues(input: unknown, catalog: Row[]): Row[] {
  if (!Array.isArray(input) || input.length > 80) return [{ code: 'invalid_fact_list', kind: 'review_metadata' }]
  return input.flatMap(raw => {
    const fact: Row = { operator: 'eq', ...object(raw) }, source = catalog.find(row => row.id === fact.unit_id), field = text(fact.field)
    const fail = (code: string, kind = 'review_metadata') => [{ code, kind, unit_id: fact.unit_id, field,
      received: fact.value, expected: source?.[field] ?? null, fragment: fact.fragment }]
    if (!source || !factUnits[field] || typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return fail('invalid_unit_fact')
    if (fact.measurement_unit != null && fact.measurement_unit !== factUnits[field]) return fail('numeric_unit_mismatch')
    if (!['eq', 'gt', 'gte', 'lt', 'lte', 'between'].includes(text(fact.operator))) return fail('invalid_numeric_operator')
    if (fact.operator === 'between' ? typeof fact.upper_value !== 'number' || !Number.isFinite(fact.upper_value)
      || fact.upper_value < fact.value : fact.upper_value != null) return fail('invalid_numeric_bounds')
    const expected = source[field]
    if (typeof expected !== 'number' || !Number.isFinite(expected)) return fail('catalog_value_unavailable', 'catalog_data')
    if (source.aggregation === 'range') {
      if (fact.operator !== 'between') return fail('range_reference_requires_interval')
      if (fact.value !== expected || fact.upper_value !== object(source.upper_values)[field]) return fail('catalog_range_mismatch', 'catalog_data')
    } else if ((source.aggregation && fact.value !== expected)
      || !satisfiesNumeric(expected, fact.value, fact.operator, fact.upper_value)) return fail('catalog_value_mismatch', 'catalog_data')
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
    unit_id: { type: 'string', enum: catalog.length ? catalog.map(row => text(row.id)) : ['none'] },
    value: { type: 'number' }, measurement_unit: { type: 'string', enum: [...new Set(Object.values(factUnits))] } }
  // Interpretation of quantities, units and comparisons belongs to the reviewer.
  properties.factual_values = { type: 'array', maxItems: catalog.length && sentenceIds.length ? 80 : 0,
    items: { anyOf: [false, true].map(interval => ({ type: 'object', additionalProperties: false,
      properties: { ...factProperties, operator: { type: 'string', enum: interval ? ['between'] : ['eq', 'gt', 'gte', 'lt', 'lte'] },
        upper_value: { type: interval ? 'number' : 'null' } },
      required: [...new Set([...Object.keys(factProperties), 'operator', 'upper_value'])] })) } }
  properties.project_values = { type: 'array', maxItems: projectFacts.length ? 40 : 0, items: { type: 'object', additionalProperties: false,
    properties: { fragment: { type: 'string', enum: sentenceIds.length ? sentenceIds : ['none'] },
      source_id: { type: 'string', enum: projectFacts.length ? projectFacts.map(row => text(row.id)) : ['none'] },
      dimension: { type: 'string' }, measurement_unit: { type: 'string' }, value: { type: 'number' } },
    required: ['fragment', 'source_id', 'dimension', 'measurement_unit', 'value'] } }
  properties.factual_inventory_complete = { type: 'boolean' }
  return { ...schema, properties, required: [...new Set([...(schema.required as string[]), 'project_values', 'factual_inventory_complete'])] }
}

export const STRUCTURED_FACT_RULES = `CONTRATO DE HECHOS ESTRUCTURADOS: Usted interpreta el borrador completo. El sistema NO extrae ni interpreta sus cifras, palabras, unidades de medida ni comparaciones. En factual_values enumere todos los hechos numéricos atribuidos a unidades o grupos y seleccione unidad/grupo, atributo, valor exacto, operador y measurement_unit (m2, USD, count o floor). Interprete números escritos con palabras y representaciones equivalentes. Convierta unidades solo cuando sean inequívocas y exactas; nunca redondee. No copie cifras de la fuente que no estén afirmadas en el borrador. En project_values incluya las cantidades del proyecto respaldadas por evidencia_turno.project_facts con source_id, dimension, measurement_unit y valor normalizado de esa fuente. Si falta una fuente, rechace la afirmación en claims/review_issues, no la omita silenciosamente. Use [] cuando no corresponda. factual_inventory_complete=true SOLO después de revisar todas las oraciones y comprobar que no omitió hechos. La cobertura, atribución y significado son responsabilidad suya; el sistema compara exclusivamente los campos estructurados con sus fuentes. Al reparar su ficha, vuelva a extraer desde el MISMO borrador, sin cambiarlo ni conservar filas que usted haya atribuido por error.`
