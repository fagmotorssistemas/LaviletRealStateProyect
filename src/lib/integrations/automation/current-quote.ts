import { text } from './data'

/** Recover a contiguous current source span. Only whitespace and quotation
 * wrappers may differ; no words, quantities, negations or order are inferred. */
export function currentQuote(value: unknown, current: string): string | null {
  const quote = text(value).trim()
  if (!quote || quote.length > 5000) return null
  if (current.includes(quote)) return quote
  const unwrapped = quote.replace(/^(?:«([\s\S]*)»|“([\s\S]*)”|"([\s\S]*)")$/, (_m, a, b, c) => a ?? b ?? c).trim()
  const parts = unwrapped.split(/\s+/u)
  const escaped = parts.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return escaped ? current.match(new RegExp(escaped, 'iu'))?.[0] || null : null
}
