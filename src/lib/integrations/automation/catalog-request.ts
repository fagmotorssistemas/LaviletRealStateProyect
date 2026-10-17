import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { currentQuote } from './current-quote'

export const CATALOG_NUMBER_FIELDS = ['bedrooms', 'bathrooms_full', 'floor_number', 'area_internal_m2', 'area_exterior_m2', 'area_total_m2', 'published_commercial_price'] as const
const purposes = ['search', 'details', 'compare', 'select', 'count', 'list', 'range', 'min', 'max', 'none']
const operators = ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'not_contains']
const fields = [...CATALOG_NUMBER_FIELDS, 'spaces', 'unmodeled']
const closed = (properties: Row): Row => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const choice = (values: readonly string[]) => ({ type: 'string', enum: values })
export const CATALOG_REQUEST_SCHEMA = closed({
  floor_query: closed({ kind: choice(['none', 'highest_available', 'above_reference', 'below_reference']),
    reference_floor: { type: ['integer', 'null'], minimum: 0, maximum: 100 },
    evidence: { type: 'string' }, confidence: choice(['high', 'medium', 'low']) }),
  surface_basis: { type: 'string', enum: ['none', 'interior', 'combined', 'compare'], description: 'Cálculo de áreas/precio por metro pedido actualmente: combined incluye interior más exterior, compare ambas bases, interior solo interior; none si no lo pide.' },
  purpose: choice(purposes), metric: { type: ['string', 'null'], enum: [...CATALOG_NUMBER_FIELDS, 'unit_count', null] },
  requirements: { type: 'array', items: closed({ field: { ...choice(fields), description: 'Dimensión solicitada, aunque su valor no aparezca en catalogo_unidades. Espacio o área exterior corresponde a area_exterior_m2. unmodeled solo para dimensiones sin campo disponible, nunca para valores desconocidos.' }, operator: choice(operators),
    value: { type: ['number', 'string', 'null'] }, upper_value: { type: ['number', 'null'] },
    strength: choice(['required', 'preferred']), evidence: { type: 'string' } }) },
  semantic_preferences: { type: 'array', items: { type: 'string' } },
  price_comparison: { anyOf: [{ type: 'null' }, closed({
    categories: { type: 'array', minItems: 2, maxItems: 4, items: choice(['suite', 'departamento', 'penthouse', 'local']) },
    evidence: { type: 'string' }, confidence: choice(['high', 'medium', 'low']),
  })] },
  evidence: { type: 'string' }, confidence: choice(['high', 'medium', 'low']),
})

export const CATALOG_REQUEST_RULES = `Interprete catalog_request dentro de esta MISMA extracción; no resuelva la consulta ni cuente el inventario.
surface_basis identifica una consulta actual de suma de áreas o precio por metro: interior, combined (interior más exterior) o compare (ambas bases). Ante precio por metro del conjunto sin base indicada, combined si ambas superficies están registradas; no afirme que existe una tarifa oficial. Use purpose=details y metric=null para ese cálculo; no lo reduzca a un rango de precios de compra. Para precio por metro incluya property_features y purchase_price, aunque no pida además el precio total; para una suma de áreas sin precios, solo property_features. Sin consulta de cálculo, surface_basis=none. Una pregunta general de precio no pide precio por metro.
Los campos de CATALOG_REQUEST_SCHEMA describen las dimensiones que el código puede consultar en las fichas completas. catalogo_unidades es un índice abreviado: que no muestre superficies, precios o espacios NO convierte esas dimensiones en unmodeled. Elija field por el significado de lo solicitado; el código consultará el valor después. Desconocer el VALOR es distinto de carecer de un CAMPO. Para cualquier requisito cuantificable use su campo disponible, incluidos requisitos de existencia (mayor que cero) aunque no se haya indicado una cantidad.
price_comparison describe una comparación actual del precio de dos o más categorías: incluya categories, evidence literal actual y confidence. Incluye inferencias de costo que motivan una preferencia, aunque no sean preguntas explícitas. Es evidencia complementaria: no convierte una categoría comparada en una preferencia elegida ni obliga a cambiar purpose, filtros, selección o exclusiones de la búsqueda principal. Sin comparación actual use null; no la herede del historial. Una consulta general de precios («qué precio tiene», incluso junto con nombre o residencia) usa purpose=range y metric=published_commercial_price, con el alcance conocido; no use none por no haberse elegido unidad o categoría. Mantenga las solicitudes de presupuesto o financiamiento separadas sin borrar la consulta de catálogo simultánea. Una recomendación familiar conserva los dormitorios solicitados y sus preferencias; las personas no son un filtro de dormitorios.
purpose distingue search (buscar opciones), details (caracteristicas de una categoria o unidades), compare (comparar referentes), select (eleccion explicita), count (cantidad de unidades), list (todas las opciones), range (intervalo), min y max (extremo), none (sin consulta de catalogo). Una consulta de detalles o continuacion conserva su operacion y sus referentes; no use none solo porque ya se conocen preferencias o presupuesto. Cuantos inmuebles hay es count y metric=unit_count; de cuantos dormitorios hay es range y metric=bedrooms. Los filtros exactos y la memoria confirmada se resuelven en codigo. semantic_preferences describe preferencias cualitativas para ordenar, no prueba que una ficha cumpla una condicion no documentada.
requirements expresa TODOS los requisitos explícitos actuales mediante field, operator, value y upper_value (solo between), strength=required o preferred y evidencia literal. Represente superficies interiores/exteriores/totales, baños, dormitorios, plantas y precios en sus campos respectivos. «Con espacio exterior» es area_exterior_m2 gt 0; «sin espacio exterior» es eq 0; «al menos 20 m² exteriores» es gte 20. No convierta superficie exterior en terraza o balcón: son características distintas. «Plantas altas» es una preferencia relativa, no invente un número exacto. «Por debajo de 300 mil» es lt 300000; no cambie operadores estrictos por inclusivos. Preserve negaciones, intervalos y unidades. Un presupuesto declarado sigue también su contrato de budget; no lo convierta en precio de una unidad.
Planta baja equivale a floor_number eq 0; primera planta alta a 1. floor_query expresa una consulta concreta de altura: highest_available si pide la última planta o la más alta disponible de los inmuebles del alcance actual; above_reference/below_reference si pide opciones por encima/debajo de una planta identificada en la conversación, indicando reference_floor. Resuelva ese referente mediante el historial real; si no puede identificarlo, use referencia null para aclararlo. No invente una planta máxima: el código la calcula con el catálogo. La consulta de otra planta conserva categoría, presupuesto y selecciones; no elige una unidad ni aumenta el importe. Una preferencia vaga por pisos altos/bajos usa floor_query.kind=none y semantic_preferences; no invente umbrales. Una planta exacta usa requirements floor_number eq con su número interpretado por IA.
spaces contiene nombres de espacios documentados (Balcón, Terraza, Estudio, etc.); use contains/not_contains y el nombre, nunca atribuya amenidades comunes a una unidad. Si una condición obligatoria no tiene campo fiable (vista, orientación, accesibilidad, uso permitido...), use field=unmodeled y conserve la condición en value. Las preferencias descriptivas van además en semantic_preferences, como citas literales. No omita condiciones para hacer parecer completa una búsqueda. Cantidad familiar no equivale a dormitorios.
evidence y cada requisito deben citar el mensaje actual sin corregir su ortografía. semantic_preferences puede resumir preferencias cualitativas interpretadas, respaldadas por evidence; no sustituye requisitos numéricos. Historial y consulta resuelta conservan las restricciones anteriores por separado. Si no hay petición de catálogo, use purpose=none, metric=null, requirements=[], semantic_preferences=[], floor_query.kind=none, evidence="". No invente valores por ser desconocidos.`

const quoted = (value: unknown, current: string) => !!text(value).trim() && text(value).length <= 1000
  && currentQuote(value, current) !== null

export function normalizedFloorQuery(raw: unknown, current: string): Row | null {
  const value = object(raw), evidence = currentQuote(value.evidence, current)
  if (!['highest_available', 'above_reference', 'below_reference'].includes(text(value.kind))
    || !acceptedExtractorConfidence(value.confidence) || !evidence) return null
  if (value.kind !== 'highest_available' && value.reference_floor !== null && !(typeof value.reference_floor === 'number'
    && Number.isInteger(value.reference_floor) && value.reference_floor >= 0 && value.reference_floor <= 100)) return null
  return { kind: value.kind, reference_floor: value.kind === 'highest_available' ? null : value.reference_floor,
    evidence, confidence: value.confidence }
}
export function normalizeCatalogRequest(raw: unknown, current: string): Row | null {
  const input = object(raw)
  if (!acceptedExtractorConfidence(input.confidence) || !purposes.includes(text(input.purpose)) || input.purpose === 'none' || !quoted(input.evidence, current)) return null
  if (!Array.isArray(input.requirements) || !Array.isArray(input.semantic_preferences)) return null
  const requirements = input.requirements.map(object).map<Row>(requirement => ({ ...requirement,
    evidence: currentQuote(requirement.evidence, current) || requirement.evidence }))
  // An invalid condition disables optimization; it never silently drops a restriction or stops the turn.
  if (requirements.length > 24 || requirements.some(r => !fields.includes(r.field as typeof fields[number])
    || !operators.includes(text(r.operator)) || !['required', 'preferred'].includes(text(r.strength)) || !quoted(r.evidence, current)
    || (CATALOG_NUMBER_FIELDS.includes(r.field as typeof CATALOG_NUMBER_FIELDS[number])
      ? typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0 || ['contains', 'not_contains'].includes(text(r.operator))
        || r.operator === 'between' && (typeof r.upper_value !== 'number' || !Number.isFinite(r.upper_value) || r.upper_value < r.value)
      : !text(r.value).trim() || r.field === 'spaces' && !['contains', 'not_contains'].includes(text(r.operator))))) return null
  if (input.semantic_preferences.length > 24 || input.semantic_preferences.some(value => typeof value !== 'string' || !value.trim() || value.length > 500)) return null
  if (['range', 'min', 'max'].includes(text(input.purpose)) && !CATALOG_NUMBER_FIELDS.includes(input.metric as typeof CATALOG_NUMBER_FIELDS[number])) return null
  return { version: 'catalog-request-v1', purpose: input.purpose, metric: input.purpose === 'count' ? 'unit_count' : input.metric ?? null,
    ...(['interior', 'combined', 'compare'].includes(text(input.surface_basis)) ? { surface_basis: input.surface_basis } : {}),
    requirements, semantic_preferences: input.semantic_preferences, evidence: currentQuote(input.evidence, current), confidence: input.confidence,
    ...(normalizedFloorQuery(input.floor_query, current) ? { floor_query: normalizedFloorQuery(input.floor_query, current) } : {}),
    ...(input.price_comparison ? { price_comparison: input.price_comparison } : {}) }
}

export function catalogRequestStatus(raw: unknown, normalized: Row | null): string {
  if (normalized) return 'validated'
  const input = object(raw)
  if (!Object.keys(input).length) return 'unavailable'
  return input.purpose === 'none' && input.metric == null
    && Array.isArray(input.requirements) && !input.requirements.length
    && Array.isArray(input.semantic_preferences) && !input.semantic_preferences.length
    && !text(input.evidence).trim() ? 'not_requested' : 'invalid'
}

export const catalogNumber = (value: unknown): number | null =>
  (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null
const normalizeSpace = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
export function requirementMatch(unit: Row, requirement: Row): boolean | null {
  if (requirement.field === 'unmodeled') return null
  if (requirement.field === 'spaces') {
    const spaces = Array.isArray(unit.spaces) ? unit.spaces.filter((v): v is string => typeof v === 'string').map(normalizeSpace) : []
    const present = spaces.includes(normalizeSpace(text(requirement.value)))
    // Space inventories are not certified exhaustive: absent is unknown, never a proven absence.
    return present ? requirement.operator === 'contains' : null
  }
  const value = catalogNumber(unit[text(requirement.field)]), expected = catalogNumber(requirement.value)
  if (value === null || expected === null) return null
  switch (requirement.operator) {
    case 'eq': return value === expected
    case 'gt': return value > expected
    case 'gte': return value >= expected
    case 'lt': return value < expected
    case 'lte': return value <= expected
    case 'between': return value >= expected && value <= Number(requirement.upper_value)
    default: return null
  }
}
