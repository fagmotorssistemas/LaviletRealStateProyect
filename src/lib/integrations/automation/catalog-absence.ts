import { object, text, type Row } from './data'

/** Render a complete empty search, including every supported constraint. No AI text is trusted. */
export function verifiedAbsenceReply(audit: Row): string | null {
  const query = object(audit.catalog_query), result = object(audit.catalog_results), filters = object(query.filters)
  if (audit.verified_catalog !== true || query.scope !== 'catalog' || query.operation !== 'search'
    || result.complete !== true || !Array.isArray(result.units) || result.units.length
    || !Array.isArray(result.unknown_unit_ids) || result.unknown_unit_ids.length
    || Array.isArray(audit.catalog_excluded_categories) && audit.catalog_excluded_categories.length) return null
  const supported = new Set(['bedrooms', 'bedrooms_any', 'bedrooms_required', 'floor_number', 'min_area_m2', 'max_area_m2'])
  if (Object.entries(filters).some(([key, value]) => !supported.has(key) && value != null)) return null
  for (const key of ['bedrooms', 'floor_number', 'min_area_m2', 'max_area_m2'])
    if (filters[key] != null && (typeof filters[key] !== 'number' || !Number.isFinite(filters[key]) || Number(filters[key]) < 0)) return null
  const options = filters.bedrooms_any == null ? [] : filters.bedrooms_any
  if (!Array.isArray(options) || options.some(value => typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) return null
  const categories: Record<string, string> = { suite: 'suites', departamento: 'departamentos', penthouse: 'penthouses', local: 'locales comerciales' }
  if (query.category && !categories[text(query.category)]) return null
  const subject = categories[text(query.category)] || (query.group === 'residential' ? 'viviendas' : query.group === 'commercial' ? 'locales comerciales' : 'inmuebles')
  const conditions = [options.length ? `de ${options.join(' o ')} dormitorios` : filters.bedrooms != null ? `de ${filters.bedrooms} dormitorios` : '',
    filters.floor_number != null ? `en la planta ${filters.floor_number}` : '',
    filters.min_area_m2 != null ? `con al menos ${filters.min_area_m2} m² interiores` : '',
    filters.max_area_m2 != null ? `con un máximo de ${filters.max_area_m2} m² interiores` : ''].filter(Boolean)
  return `Actualmente no contamos con ${subject} disponibles${conditions.length ? ' ' + conditions.join(' y ') : ''}.`
}

/** Narrow recovery for a single catalogue question; never bypass profile or mixed policy/action requests. */
export function canRecoverAbsence(audit: Row, requests: Row[], intent: Row): boolean {
  const interpreted = (Array.isArray(intent.requests) ? intent.requests : []).map(object).filter(item => item.domain !== 'courtesy')
  const filters = object(object(audit.catalog_query).filters)
  const fields = new Set([
    ...(filters.bedrooms != null || Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length ? ['bedrooms'] : []),
    ...(filters.floor_number != null ? ['floor_number'] : []),
    ...(filters.min_area_m2 != null || filters.max_area_m2 != null ? ['area_internal_m2'] : []),
  ])
  return audit.source === 'catalog_search' && !audit.profile_introduction && intent.profile_pending !== true && !intent.requested_action
    && interpreted.length === 1 && interpreted[0].domain === 'property'
    && requests.length === 1 && fields.has(text(requests[0].fact_key))
    && ['answered', 'missing_fact'].includes(text(requests[0].status)) && !!verifiedAbsenceReply(audit)
}
