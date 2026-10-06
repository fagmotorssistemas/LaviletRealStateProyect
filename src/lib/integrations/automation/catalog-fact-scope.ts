import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

/** Code-owned membership conditions, before selecting examples for a prompt. */
export function catalogFactScope(query: Row, requirements: Row[] = [], excluded: unknown = [], scopedIds?: string[]): Row {
  const filters = object(query.filters)
  const required = [...rows(query.requirements), ...requirements].filter(row => row.strength === 'required')
  const covered = new Set(required.map(row => row.field))
  const predicates: Row[] = required.map(row => ({ field: row.field, operator: row.operator, value: row.value, upper_value: row.upper_value ?? null }))
  const add = (field: string, operator: string, value: unknown, upper_value: unknown = null) => {
    if (value != null && !covered.has(field)) predicates.push({ field, operator, value, upper_value })
  }
  add('bedrooms', text(filters.bedrooms_operator) || 'eq', filters.bedrooms, filters.bedrooms_upper)
  add('floor_number', 'eq', filters.floor_number)
  add('area_internal_m2', 'gte', filters.min_area_m2)
  add('area_internal_m2', 'lte', filters.max_area_m2)
  return { group: query.group ?? null, category: query.category ?? null, filters: predicates,
    ...(Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length ? { bedrooms_any: filters.bedrooms_any } : {}),
    excluded_categories: Array.isArray(excluded) ? excluded : [], restricted_to_ids: scopedIds !== undefined }
}

const interval = (row: Row) => {
  const value = Number(row.value)
  switch (row.operator) {
    case 'eq': return [value, value, true, true] as const
    case 'gt': return [value, Infinity, false, false] as const
    case 'gte': return [value, Infinity, true, false] as const
    case 'lt': return [-Infinity, value, false, false] as const
    case 'lte': return [-Infinity, value, false, true] as const
    case 'between': return [value, Number(row.upper_value), true, true] as const
    default: return null
  }
}
const combinedInterval = (rows: Row[]) => {
  const bounds = rows.map(interval)
  if (!bounds.length || bounds.some(bound => bound === null)) return null
  return bounds.reduce<[number, number, boolean, boolean]>((result, bound) => {
    const [lower, upper, lowerClosed, upperClosed] = bound!
    return [Math.max(result[0], lower), Math.min(result[1], upper),
      lower > result[0] ? lowerClosed : lower === result[0] ? lowerClosed && result[2] : result[2],
      upper < result[1] ? upperClosed : upper === result[1] ? upperClosed && result[3] : result[3]]
  }, [-Infinity, Infinity, false, false])
}
const normalizedSpace = (value: unknown) => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es')

/** A narrower claim can be checked within a source; a broader one cannot.
 * Compare predicates, never the numbers the writer happens to assert. */
export function claimWithinCatalogScope(claim: Row, source: Row): boolean {
  const category = text(claim.category)
  const group = claim.group || (category ? category === 'local' ? 'commercial' : 'residential' : null)
  if (source.category && category !== source.category || source.group && group !== source.group) return false
  if (Array.isArray(source.excluded_categories) && source.excluded_categories.length
    && (!category || source.excluded_categories.includes(category))) return false
  const filters = rows(claim.filters)
  if (Array.isArray(source.bedrooms_any) && source.bedrooms_any.length
    && !filters.some(row => row.field === 'bedrooms' && row.operator === 'eq' && (source.bedrooms_any as unknown[]).includes(row.value))) return false
  return rows(source.filters).every(required => {
    if (required.field === 'spaces') return filters.some(row => row.field === 'spaces' && row.operator === required.operator
      && normalizedSpace(row.value) === normalizedSpace(required.value))
    const outer = interval(required)
    const inner = combinedInterval(filters.filter(row => row.field === required.field))
    return outer !== null && inner !== null && (inner[0] > outer[0] || inner[0] === outer[0] && (!inner[2] || outer[2]))
      && (inner[1] < outer[1] || inner[1] === outer[1] && (!inner[3] || outer[3]))
  })
}
