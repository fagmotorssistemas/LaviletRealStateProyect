/** Shared numeric contract. Comparisons are computed from evidence, never from a model verdict. */
export const numericOperators = ['eq', 'gt', 'gte', 'lt', 'lte', 'between'] as const
export type NumericOperator = typeof numericOperators[number]
export const decimalNumber = (value: string) => {
  const clean = value.replace(/[.,]$/, '')
  const last = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','))
  return last >= 0 && clean.length - last <= 3
    ? Number(clean.slice(0, last).replace(/[.,]/g, '') + '.' + clean.slice(last + 1)) : Number(clean.replace(/[.,]/g, ''))
}
export function satisfiesNumeric(actual: number, value: number, operator: unknown = 'eq', upper?: unknown) {
  if (!Number.isFinite(actual) || !Number.isFinite(value)) return false
  switch (operator ?? 'eq') {
    case 'eq': return Math.abs(actual - value) < 0.005
    case 'gt': return actual > value
    case 'gte': return actual >= value
    case 'lt': return actual < value
    case 'lte': return actual <= value
    case 'between': return typeof upper === 'number' && Number.isFinite(upper) && upper >= value && actual >= value && actual <= upper
    default: return false
  }
}
export function relationBefore(value: string): NumericOperator {
  if (/(?:al menos|como minimo|no menos de|mayor(?:es)? o igual(?:es)? (?:a|que))\s*$/.test(value)) return 'gte'
  if (/(?:como maximo|no mas de|menor(?:es)? o igual(?:es)? (?:a|que))\s*$/.test(value)) return 'lte'
  if (/(?:mas de|superior(?:es)? a|mayor(?:es)? (?:a|que))\s*$/.test(value)) return 'gt'
  if (/(?:menos de|inferior(?:es)? a|menor(?:es)? (?:a|que))\s*$/.test(value)) return 'lt'
  return 'eq'
}
export function areaAssertions(clause: string) {
  const matches = [...clause.matchAll(/(\d[\d.,]*)(?:\s*(a|y|o|–|-)\s*(\d[\d.,]*))?\s*(?:m2|metros? cuadrados?)/g)]
  return matches.map(match => {
    const before = clause.slice(0, match.index)
    const after = clause.slice((match.index || 0) + match[0].length)
    const suffix = after.match(/^\s*(?:(?:de|del)\s+)?(?:(?:area|superficie|espacio)\s+)?(interior(?:es)?|exterior(?:es)?)/)?.[1]
    const prefix = before.match(/(?:area|superficie|espacio)\s+(interior|exterior)\s*(?:de\s*)?$/)?.[1]
    const field = (suffix || prefix)?.startsWith('exterior') ? 'area_exterior_m2' : 'area_internal_m2'
    const values = [decimalNumber(match[1]), ...(match[3] ? [decimalNumber(match[3])] : [])]
    const range = values.length === 2 && (['a', '–', '-'].includes(match[2]) || /\bentre\s*$/.test(before))
    return { field, fieldExplicit: Boolean(suffix || prefix), values, operator: range ? 'between' as const : relationBefore(before),
      fragment: match[0], derived: /^\s*(?:(?:interior|exterior)(?:es)?\s*)?(?:mas|menos|adicionales|de diferencia)\b/.test(after),
      exactRange: range && !/\bentre\s*$/.test(before) }
  })
}
