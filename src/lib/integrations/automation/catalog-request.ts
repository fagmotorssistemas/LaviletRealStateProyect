import { object, text, type Row } from './data'

export const CATALOG_NUMBER_FIELDS = ['bedrooms', 'bathrooms_full', 'floor_number', 'area_internal_m2', 'area_exterior_m2', 'area_total_m2', 'published_commercial_price'] as const
const purposes = ['search', 'count', 'list', 'range', 'min', 'max', 'none']
const operators = ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'contains', 'not_contains']
const fields = [...CATALOG_NUMBER_FIELDS, 'spaces', 'unmodeled']
const closed = (properties: Row): Row => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) })
const choice = (values: readonly string[]) => ({ type: 'string', enum: values })
export const CATALOG_REQUEST_SCHEMA = closed({
  purpose: choice(purposes), metric: { type: ['string', 'null'], enum: [...CATALOG_NUMBER_FIELDS, 'unit_count', null] },
  requirements: { type: 'array', items: closed({ field: { ...choice(fields), description: 'Dimensión solicitada, aunque su valor no aparezca en catalogo_unidades. Espacio o área exterior corresponde a area_exterior_m2. unmodeled solo para dimensiones sin campo disponible, nunca para valores desconocidos.' }, operator: choice(operators),
    value: { type: ['number', 'string', 'null'] }, upper_value: { type: ['number', 'null'] },
    strength: choice(['required', 'preferred']), evidence: { type: 'string' } }) },
  semantic_preferences: { type: 'array', items: { type: 'string' } },
  evidence: { type: 'string' }, confidence: choice(['high', 'medium', 'low']),
})

export const CATALOG_REQUEST_RULES = `Interprete catalog_request dentro de esta MISMA extracción; no resuelva la consulta ni cuente el inventario.
Los campos de CATALOG_REQUEST_SCHEMA describen las dimensiones que el código puede consultar en las fichas completas. catalogo_unidades es un índice abreviado: que no muestre superficies, precios o espacios NO convierte esas dimensiones en unmodeled. Elija field por el significado de lo solicitado; el código consultará el valor después. Desconocer el VALOR es distinto de carecer de un CAMPO. Para cualquier requisito cuantificable use su campo disponible, incluidos requisitos de existencia (mayor que cero) aunque no se haya indicado una cantidad.
Una consulta general de precios («qué precio tiene», incluso junto con nombre o residencia) usa purpose=range y metric=published_commercial_price, con el alcance conocido; no use none por no haberse elegido unidad o categoría. Mantenga las solicitudes de presupuesto o financiamiento separadas sin borrar la consulta de catálogo simultánea. Una recomendación familiar conserva los dormitorios solicitados y sus preferencias; las personas no son un filtro de dormitorios.
purpose distingue search (buscar opciones), count (cantidad de unidades), list (todas las opciones), range (intervalo), min y max (extremo), none (sin consulta simple). «Cuántos departamentos de 3 dormitorios», «dime la cantidad de opciones de tres cuartos» y variantes son count, metric=unit_count. «De cuántos dormitorios tienen» pide tipos de dormitorios, no cantidad de unidades: range, metric=bedrooms. Mantenga property.operation=search para búsquedas, conteos, listados y rangos; las demás operaciones existentes siguen vigentes.
requirements expresa TODOS los requisitos explícitos actuales mediante field, operator, value y upper_value (solo between), strength=required o preferred y evidencia literal. Represente superficies interiores/exteriores/totales, baños, dormitorios, plantas y precios en sus campos respectivos. «Con espacio exterior» es area_exterior_m2 gt 0; «sin espacio exterior» es eq 0; «al menos 20 m² exteriores» es gte 20. No convierta superficie exterior en terraza o balcón: son características distintas. «Plantas altas» es una preferencia relativa, no invente un número exacto. «Por debajo de 300 mil» es lt 300000; no cambie operadores estrictos por inclusivos. Preserve negaciones, intervalos y unidades. Un presupuesto declarado sigue también su contrato de budget; no lo convierta en precio de una unidad.
spaces contiene nombres de espacios documentados (Balcón, Terraza, Estudio, etc.); use contains/not_contains y el nombre, nunca atribuya amenidades comunes a una unidad. Si una condición obligatoria no tiene campo fiable (vista, orientación, accesibilidad, uso permitido...), use field=unmodeled y conserve la condición en value. Las preferencias descriptivas van además en semantic_preferences, como citas literales. No omita condiciones para hacer parecer completa una búsqueda. Cantidad familiar no equivale a dormitorios.
evidence y cada requisito deben citar el mensaje actual sin corregir su ortografía. Historial y consulta resuelta conservan las restricciones anteriores por separado. Si no hay petición de catálogo, use purpose=none, metric=null, requirements=[], semantic_preferences=[], evidence="". No invente valores por ser desconocidos.`

const quoted = (value: unknown, current: string) => !!text(value).trim() && text(value).length <= 1000
  && current.normalize('NFKC').toLowerCase().includes(text(value).normalize('NFKC').toLowerCase())
export function normalizeCatalogRequest(raw: unknown, current: string): Row | null {
  const input = object(raw)
  if (input.confidence !== 'high' || !purposes.includes(text(input.purpose)) || input.purpose === 'none' || !quoted(input.evidence, current)) return null
  if (!Array.isArray(input.requirements) || !Array.isArray(input.semantic_preferences)) return null
  const requirements = input.requirements.map(object)
  // An invalid condition disables optimization; it never silently drops a restriction or stops the turn.
  if (requirements.length > 24 || requirements.some(r => !fields.includes(r.field as typeof fields[number])
    || !operators.includes(text(r.operator)) || !['required', 'preferred'].includes(text(r.strength)) || !quoted(r.evidence, current)
    || (CATALOG_NUMBER_FIELDS.includes(r.field as typeof CATALOG_NUMBER_FIELDS[number])
      ? typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < 0 || ['contains', 'not_contains'].includes(text(r.operator))
        || r.operator === 'between' && (typeof r.upper_value !== 'number' || !Number.isFinite(r.upper_value) || r.upper_value < r.value)
      : !text(r.value).trim() || r.field === 'spaces' && !['contains', 'not_contains'].includes(text(r.operator))))) return null
  if (input.semantic_preferences.some(value => !quoted(value, current))) return null
  if (['range', 'min', 'max'].includes(text(input.purpose)) && !CATALOG_NUMBER_FIELDS.includes(input.metric as typeof CATALOG_NUMBER_FIELDS[number])) return null
  return { version: 'catalog-request-v1', purpose: input.purpose, metric: input.purpose === 'count' ? 'unit_count' : input.metric ?? null,
    requirements, semantic_preferences: input.semantic_preferences, evidence: input.evidence, confidence: 'high' }
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
