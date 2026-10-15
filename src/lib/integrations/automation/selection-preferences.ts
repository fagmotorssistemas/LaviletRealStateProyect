import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'

const decision = (values: string[]) => ({ type: 'object', additionalProperties: false,
  properties: { kind: { type: 'string', enum: values }, evidence: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['kind', 'evidence', 'confidence'] })

/** Constraints decide eligibility; priorities order eligible options. Neither
 * a unit's characteristics nor the writer's suggestion declares a client need. */
export const SELECTION_PREFERENCES_SCHEMA = { type: 'object', additionalProperties: false,
  properties: { bedrooms: decision(['unchanged', 'unrestricted', 'constrained']),
    priority: decision(['unchanged', 'interior_space', 'views', 'clear']) }, required: ['bedrooms', 'priority'] }

export const SELECTION_PREFERENCES_RULES = `selection_preferences separa restricciones y prioridades declaradas en mensaje_actual. bedrooms.kind=unrestricted cuando el cliente expresa que la cantidad no le importa o que quiere omitir ese requisito; constrained si declara una cantidad, mínimo o rango, también en property.filters y housing_quantities; unchanged si no cambia ese requisito. priority.kind=interior_space cuando prioriza amplitud interior; clear solo si retira esa prioridad, y unchanged en otro caso. Cada cambio requiere evidencia literal actual y confianza suficiente. «Los dormitorios no son importantes, quiero algo espacioso» deja dormitorios libres y prioriza área interior, sin inventar un mínimo. Después «mínimo dos» impone gte=2 y conserva la prioridad de amplitud. Elegir penthouse o una unidad de tres dormitorios NO declara una preferencia de tres. Las características de opciones ofrecidas nunca se copian como requisitos del cliente. Un sí que continúa una prioridad ya conocida conserva el estado; no exige proponer una cantidad nueva. Si cambia estas preferencias sin pedir una unidad específica, use property.operation=search, query_scope=catalog; el cambio es una búsqueda de opciones, no una negativa que requiera volver a pedir dormitorios.`

export function normalizedSelectionPreferences(raw: unknown, current: string): Row {
  const input = object(raw), result: Row = {}
  for (const [field, kinds] of [['bedrooms', ['unrestricted', 'constrained']], ['priority', ['interior_space', 'views', 'clear']]] as const) {
    const change = object(input[field]), evidence = text(change.evidence).trim()
    if (!(kinds as readonly string[]).includes(text(change.kind)) || !acceptedExtractorConfidence(change.confidence)
      || !evidence || !current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())) continue
    result[field] = { kind: change.kind, evidence, confidence: change.confidence }
  }
  return result
}

export function selectionPreferences(known: unknown, current: unknown = {}): Row {
  return { ...object(known), ...object(current) }
}

export const unrestrictedBedrooms = (preferences: unknown) => object(object(preferences).bedrooms).kind === 'unrestricted'
export const prioritizesInteriorSpace = (preferences: unknown) => object(object(preferences).priority).kind === 'interior_space'
export const prioritizesViews = (preferences: unknown) => object(object(preferences).priority).kind === 'views'

export const VIEWS_PREFERENCE_RULES = 'priority.kind=views si prioriza vistas; la prioridad ordena qué conviene comparar, no acredita qué unidad tiene la mejor vista ni inventa orientación. Conserve el motivo literal. Una jubilación, edad u origen no declara accesibilidad, movilidad reducida ni residencia actual. No infiera amplitud de una cantidad alta de dormitorios: puede ofrecerla como alternativa explícita, conservando el requisito original hasta su aceptación.'

export function withoutBedroomConstraint(query: Row): Row {
  const filters = { ...object(query.filters), bedrooms: null, bedrooms_required: null }
  for (const key of ['bedrooms_any', 'bedrooms_operator', 'bedrooms_upper']) delete (filters as Row)[key]
  return { ...query, filters, requirements: Array.isArray(query.requirements)
    ? query.requirements.filter(requirement => object(requirement).field !== 'bedrooms') : [] }
}

/** Missing measurements are unknown, not zero. Stable ties keep their order. */
export function spaciousOptions(units: Row[], limit = 2): Row[] {
  return units.filter(unit => typeof unit.area_internal_m2 === 'number' && unit.area_internal_m2 > 0)
    .sort((a, b) => Number(b.area_internal_m2) - Number(a.area_internal_m2)).slice(0, limit)
}
