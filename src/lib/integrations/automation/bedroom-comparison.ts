import { object, type Row } from './data'

export type BedroomComparison = { bedrooms_operator?: 'gte' | 'lte' | 'between'; bedrooms_upper?: number | null }
export function bedroomComparison(raw: unknown): BedroomComparison {
  const row = object(raw)
  if (typeof row.bedrooms !== 'number' || Array.isArray(row.bedrooms_any) && row.bedrooms_any.length > 1) return {}
  if (row.bedrooms_operator === 'gte' || row.bedrooms_operator === 'lte') return { bedrooms_operator: row.bedrooms_operator }
  if (row.bedrooms_operator === 'between') return { bedrooms_operator: 'between',
    bedrooms_upper: typeof row.bedrooms_upper === 'number' && Number.isInteger(row.bedrooms_upper)
      && row.bedrooms_upper >= row.bedrooms && row.bedrooms_upper <= 30 ? row.bedrooms_upper : null }
  return {}
}

/** Current bedroom constraints replace the complete previous relation, not just
 * its lower endpoint. No natural-language interpretation occurs here. */
export function replaceBedroomComparison<T extends Row>(merged: T, current: Row): T {
  if (current.bedrooms == null && !(Array.isArray(current.bedrooms_any) && current.bedrooms_any.length)) return merged
  const result: Row = { ...merged }
  delete result.bedrooms_operator; delete result.bedrooms_upper
  return { ...result, ...bedroomComparison(current) } as T
}

export function matchesBedrooms(actual: number | null, filters: Row): boolean {
  const choices = filters.bedrooms_any
  if (Array.isArray(choices) && choices.length) return actual !== null && choices.includes(actual)
  const value = filters.bedrooms
  if (value == null) return true
  if (actual === null || typeof value !== 'number') return false
  if (filters.bedrooms_operator === 'gte') return actual >= value
  if (filters.bedrooms_operator === 'lte') return actual <= value
  if (filters.bedrooms_operator === 'between') return typeof filters.bedrooms_upper === 'number'
    && filters.bedrooms_upper >= value && actual >= value && actual <= filters.bedrooms_upper
  return actual === value
}

export function bedroomCondition(filters: Row): string {
  if (Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.length) return `de ${filters.bedrooms_any.join(' o ')} dormitorios`
  if (filters.bedrooms == null) return ''
  const n = filters.bedrooms
  return filters.bedrooms_operator === 'gte' ? `de al menos ${n} dormitorios`
    : filters.bedrooms_operator === 'lte' ? `de como máximo ${n} dormitorios`
      : filters.bedrooms_operator === 'between' ? `de entre ${n} y ${filters.bedrooms_upper} dormitorios`
        : `de ${n} dormitorios`
}
