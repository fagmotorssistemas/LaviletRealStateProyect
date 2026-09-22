import { object, text, type Row } from './data'

export const coverageFactKeys = ['catalog_comparison', 'bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number', 'price', 'policy', 'other'] as const
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Conservative compatibility for old reviews without a requested fact key.
 * Extra subject words (e.g. mascotas, alícuotas) deliberately prevent coverage. */
function onlyCatalogComparison(fragment: string) {
  const words = normalized(fragment).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.some(word => /^(?:diferencias?|diferencian?|comparacion|compara(?:r|rlos)?|iguales?|mismos?|mismas?|tamanos?|superficies?)$/.test(word))) return false
  const allowed = new Set('y o pero entonces bueno ya si no son es tienen hay cual cuales que como cuanto cuantos la el las los una un unos unas de del entre en cada uno todos todas estas estos esos esas opciones unidades departamentos apartamentos suites penthouses viviendas diferencia diferencias diferencian comparacion compara comparar compararlos iguales mismo mismos misma mismas tamano tamanos superficie superficies interior exterior interiores exteriores metros cuadrados dormitorios habitaciones cuartos banos plantas pisos por favor porfa me puede puedes podria explicar decir mostrar'.split(' '))
  return words.every(word => allowed.has(word) || /^\d{1,4}$/.test(word))
}

/** The tool result can contradict an AI claim that an already answered fact is missing. */
export function catalogCoversFragment(fragment: string, factKey: unknown, audit: Row = {}) {
  if (audit.verified_catalog !== true) return false
  const coverage = object(audit.catalog_coverage)
  const complete = object(audit.catalog_comparison)
  const units = (Array.isArray(object(audit.catalog_results).units) ? object(audit.catalog_results).units as unknown[] : []).map(object)
  if (!units.length) return false
  const n = normalized(fragment)
  const mentionedUnits = [...(n.match(/\b\d{3,4}\b/g) || []),
    ...[...n.matchAll(/\b(?:departamento|suite|penthouse|unidad)\s+(?:numero\s+)?(\d+)\b/g)].map(match => match[1])]
  const unitNumbers = new Set(units.map(unit => text(unit.unit_number).toLowerCase()))
  if (mentionedUnits.some(number => !unitNumbers.has(number))) return false
  const mentionedCategories = [...n.matchAll(/\b(departamentos?|apartamentos?|suites?|penthouses?)\b/g)]
    .map(match => match[1].startsWith('apartamento') || match[1].startsWith('departamento') ? 'departamento'
      : match[1].startsWith('suite') ? 'suite' : 'penthouse')
  if (mentionedCategories.some(category => !units.some(unit => normalized(text(unit.category)) === category))) return false
  for (const match of n.matchAll(/\b(departamento|apartamento|suite|penthouse)\s+(?:numero\s+)?(\d+)\b/g)) {
    const category = match[1] === 'apartamento' ? 'departamento' : match[1]
    if (!units.some(unit => text(unit.unit_number) === match[2] && normalized(text(unit.category)) === category)) return false
  }
  const comparison = coverage.operation === 'compare' || audit.source === 'catalog_compare'
  const known = new Set((Array.isArray(coverage.known_fields) ? coverage.known_fields : []).map(text))
  for (const key of ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number']) {
    if (units.every(unit => unit[key] !== null && unit[key] !== undefined && unit[key] !== '' && Number.isFinite(Number(unit[key]))
      && Number(unit[key]) >= (key === 'floor_number' ? 0 : Number.MIN_VALUE))) known.add(key)
  }
  if (comparison && onlyCatalogComparison(fragment)) {
    const required = ['bedrooms', 'area_internal_m2', 'area_exterior_m2', 'floor_number', ...(/\bbanos?\b/.test(normalized(fragment)) ? ['bathrooms_full'] : [])]
    return required.every(key => known.has(key))
      && (coverage.status === 'answered' || object(complete.interior).complete === true)
  }
  // Attribute checks require both a declared dimension and a narrowly matching
  // question; a model cannot label a mixed/unknown policy question as covered.
  const attribute = text(factKey)
  const patterns: Record<string, RegExp> = {
    bedrooms: /^(?:y |pero |entonces )*(?:cuantos? |que |cual es el numero de )?(?:dormitorios?|habitaciones?|cuartos?) (?:tiene|tienen|hay)(?: (?:el|la|los|las|departamento|suite|penthouse|unidad|\d+))*[?.! ]*$/,
    floor_number: /^(?:y )?(?:en )?que (?:piso|planta) (?:esta|estan|se encuentra|se encuentran)(?: (?:el|la|los|las|departamento|suite|penthouse|unidad|\d+))*[?.! ]*$/,
  }
  return known.has(attribute) && Boolean(patterns[attribute]?.test(n.replace(/[¿¡]/g, '').trim()))
}

export function assessMissingFacts(fragments: string[], audit: Row, facts: Row[] = []) {
  const assessments = [...new Set(fragments)].map(fragment => {
    const request = facts.find(row => text(row.fragment) === fragment)
    const answered = catalogCoversFragment(fragment, request?.fact_key, audit)
    return { fragment, fact_key: text(request?.fact_key) || null, outcome: answered ? 'answered_by_catalog' : 'missing_fact',
      reason: answered ? 'El catálogo verificado ya responde esta consulta.' : text(request?.evidence) || 'La revisión identificó un dato concreto sin respaldo.' }
  })
  return { assessments, unresolved: assessments.filter(item => item.outcome === 'missing_fact').map(item => item.fragment) }
}
