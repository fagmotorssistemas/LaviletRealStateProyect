import { object, text, type Row } from './data'
import { decimalNumber, relationBefore, satisfiesNumeric } from './numeric-relations'

/** Project quantities are independent of unit prices/areas, handled by the catalogue contract. */
type Quantity = { value: number; dimension: string; unit: string; literal: string; start: number; end: number }
export type ProjectFact = { id: string; source: string; subject: string; evidence: string; value: number; dimension: string; unit: string }
const normalized = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const measures: Record<string, [string, string, number]> = {
  h: ['duration', 'hour', 1], hr: ['duration', 'hour', 1], hrs: ['duration', 'hour', 1], hora: ['duration', 'hour', 1], horas: ['duration', 'hour', 1],
  min: ['duration', 'hour', 1 / 60], minuto: ['duration', 'hour', 1 / 60], minutos: ['duration', 'hour', 1 / 60],
  '%': ['percentage', 'percent', 1], 'por ciento': ['percentage', 'percent', 1],
  km: ['distance', 'meter', 1000], kilometro: ['distance', 'meter', 1000], kilometros: ['distance', 'meter', 1000],
  m: ['distance', 'meter', 1], metro: ['distance', 'meter', 1], metros: ['distance', 'meter', 1],
}
export function projectQuantities(value: string): Quantity[] {
  const pattern = /(?<![\w.,])\d+(?:[.,]\d+)*(?:\s*)(?:por ciento|kil[oó]metros?|minutos?|horas?|metros?|hrs?|km|min|h|m|%)(?![\p{L}\d²]|\s*(?:cuadrad|2\b))/giu
  return [...value.matchAll(pattern)].flatMap(match => {
    const parts = normalized(match[0]).match(/^(\d[\d.,]*)\s*(.+)$/)
    const unit = parts && measures[parts[2]]
    if (!parts || !unit) return []
    return [{ value: decimalNumber(parts[1]) * unit[2], dimension: unit[0], unit: unit[1], literal: match[0], start: match.index!, end: match.index! + match[0].length }]
  })
}
const stop = new Set('el la los las de del en con para por un una unos unas y o a al que se es son tiene tienen cuenta contamos ofrece ofrecemos sistemas sistema hasta desde mas menos como maximo minimo solo'.split(' '))
const words = (s: string) => normalized(s).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w) && !measures[w])

/** Explicit operational sources only. Never promote history, client text or AI summaries to evidence. */
export function projectQuantityEvidence(verified: Row): ProjectFact[] {
  const facts: ProjectFact[] = []
  const sources = ['instalaciones', 'politica_comercial', 'financiamiento', 'financing_policy']
  const visit = (value: unknown, path: string, subject = '') => {
    if (Array.isArray(value)) { value.forEach((v, i) => visit(v, `${path}.${i}`, subject)); return }
    if (value && typeof value === 'object') {
      const row = object(value)
      const name = text(row.amenity_name || row.name || row.title) || subject
      for (const [key, child] of Object.entries(row)) {
        if (/id$|_at$|historial|history|summary|resumen|prompt|example/i.test(key)) continue
        visit(child, `${path}.${key}`, name || key.replace(/_/g, ' '))
      }
    } else if (typeof value === 'string') {
      for (const q of projectQuantities(value)) facts.push({ id: `project:${path}:${facts.length}`, source: path,
        subject: subject || path, evidence: value, value: q.value, dimension: q.dimension, unit: q.unit })
    }
  }
  for (const source of sources) if (verified[source] != null) visit(verified[source], source)
  return facts
}

export function validateProjectQuantities(reply: string, evidence: ProjectFact[]) {
  const details: Row[] = [], supportedSpans: Array<{ start: number; end: number }> = []
  for (const q of projectQuantities(reply)) {
    // A sentence is not enough: a list can assign different quantities to different subjects.
    const before = reply.slice(0, q.start).split(/[.!?;\n]|,(?!\d)/).at(-1) || ''
    const after = reply.slice(q.end).split(/[.!?;,\n]/)[0]
    const local = before.slice(-100) + ' ' + after.slice(0, 75)
    const proximity = (fact: ProjectFact) => {
      const terms = new Set(words(fact.subject))
      const left = [...normalized(before).matchAll(/[a-z]+/g)].filter(m => terms.has(m[0]))
      const right = [...normalized(after).matchAll(/[a-z]+/g)].filter(m => terms.has(m[0]))
      return Math.min(...left.map(m => before.length - m.index! - m[0].length), ...right.map(m => m.index!))
    }
    const ranked = evidence.filter(f => f.dimension === q.dimension).map(f => ({ fact: f, distance: proximity(f) }))
    const nearest = Math.min(...ranked.map(r => r.distance))
    const relevant = ranked.filter(r => Number.isFinite(nearest) && r.distance === nearest).map(r => r.fact)
    if (!relevant.length) {
      details.push({ code: 'quantity_reference_unresolved', kind: 'reference', fragment: q.literal, context: local.trim(), received: q.value, unit: q.unit, outcome: 'unresolved' }); continue
    }
    const operator = relationBefore(normalized(before))
    // A project fact describes an actual value; range endpoints cannot exaggerate it.
    const candidates = relevant.filter(f => satisfiesNumeric(f.value, q.value, operator)
      && (!/\b(?:hasta|desde)\s*$/i.test(before) || satisfiesNumeric(f.value, q.value)))
    const distinct = new Set(relevant.map(f => f.value))
    const matched = distinct.size === 1 ? candidates[0] : undefined
    if (matched) supportedSpans.push({ start: q.start, end: q.end })
    details.push({ code: matched ? 'quantity_supported' : distinct.size > 1 ? 'quantity_evidence_conflict' : 'quantity_value_mismatch',
      kind: matched ? 'evidence' : distinct.size > 1 ? 'reference' : 'fact', outcome: matched ? 'supported' : distinct.size > 1 ? 'unresolved' : 'contradicted',
      fragment: q.literal, context: local.trim(), received: q.value, unit: q.unit, operator,
      evidence: relevant.map(f => ({ id: f.id, source: f.source, subject: f.subject, text: f.evidence, value: f.value, unit: f.unit })) })
  }
  return { details, supportedSpans, issues: [...new Set(details.filter(d => d.outcome !== 'supported').map(d => text(d.code)))] }
}

/** Mask only matched quantities; a supported duration cannot whitelist an unrelated price/area. */
export function withoutSupportedQuantities(reply: string, spans: Array<{ start: number; end: number }>) {
  let result = reply
  for (const span of [...spans].sort((a, b) => b.start - a.start)) result = result.slice(0, span.start) + ' '.repeat(span.end - span.start) + result.slice(span.end)
  return result
}
