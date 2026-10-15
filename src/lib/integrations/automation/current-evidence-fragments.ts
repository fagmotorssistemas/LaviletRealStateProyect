import { object, text, type Row } from './data'

export const EVIDENCE_SOURCES_SCHEMA = { type: 'array', maxItems: 30, items: { type: 'object', additionalProperties: false,
  properties: { field: { type: 'string', description: 'property, primary_intent, catalog_request o requests.N; nunca permisos, dinero ni identidad.' },
    fragment_ids: { type: 'array', maxItems: 30, items: { type: 'string' } } }, required: ['field', 'fragment_ids'] } }
const comparable = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\S\r\n]+/g, ' ').trim()

/** Restore complete source lines, never change numbers, negations or order. */
export function formattedEvidenceQuote(value: unknown, current: string): string {
  const quote = text(value).trim()
  if (!quote || current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())) return quote
  const unwrapped = quote.replace(/^(?:«([\s\S]*)»|“([\s\S]*)”|"([\s\S]*)")$/, (_m, a, b, c) => a ?? b ?? c)
  const parts = unwrapped.split(/\r?\n/).filter(line => line.trim())
  const lines = [...current.matchAll(/[^\r\n]+/g)].filter(match => match[0].trim())
  const matches: [number, number][] = []
  for (let start = 0; start < lines.length; start++) {
    if (parts.length && parts.every((part, offset) => lines[start + offset] && comparable(lines[start + offset][0]) === comparable(part)))
      matches.push([start, start + parts.length - 1])
  }
  if (matches.length !== 1) return quote
  const [first, last] = matches[0]
  return current.slice(lines[first].index, lines[last].index! + lines[last][0].length)
}

/** Current IDs must name a consecutive source span. Gaps require a model
 * recheck, because an intervening message may contradict a selection. */
function referencedQuote(source: Row, current: string): string | null {
  if (!Array.isArray(source.fragment_ids) || !source.fragment_ids.length) return null
  const fragments = currentMessageFragments(current), indexes = source.fragment_ids.map(id => fragments.findIndex(fragment => fragment.id === id))
  if (indexes.some(index => index < 0) || indexes.some((index, offset) => offset > 0 && index !== indexes[offset - 1] + 1)) return null
  return formattedEvidenceQuote(indexes.map(index => fragments[index].content).join('\n'), current)
}

export function reconcileEvidenceSources(raw: Row, current: string): Row {
  const result = structuredClone(raw), semantics = object(result.turn_semantics)
  const sources = Array.isArray(raw.evidence_sources) ? raw.evidence_sources.map(object) : []
  for (const source of sources) {
    const quote = referencedQuote(source, current)
    if (!quote) continue
    if (source.field === 'property') semantics.property = { ...object(semantics.property), evidence: quote }
    else if (source.field === 'primary_intent') semantics.primary_evidence = quote
    else if (source.field === 'catalog_request' && result.catalog_request) result.catalog_request = { ...object(result.catalog_request), evidence: quote }
    else if (/^requests\.\d+$/.test(text(source.field)) && Array.isArray(result.requests)) {
      const index = Number(text(source.field).split('.')[1]), request = object(result.requests[index])
      if (request.domain === 'property') result.requests[index] = { ...request, evidence: quote }
    }
  }
  result.turn_semantics = semantics
  return result
}

export function currentMessageFragments(current: string): Row[] {
  return current.split(/\r?\n/).map((content, index) => ({ id: `current:${index + 1}`, content }))
    .filter(fragment => fragment.content.trim())
}

/** Restore the actual source span of a multi-message informational quotation.
 * No paraphrases, historical fragments, reordering or operational permissions. */
export function informationalEvidenceQuote(value: unknown, current: string): string {
  const quote = text(value).trim(), normalized = current.normalize('NFKC').toLowerCase()
  if (!quote || normalized.includes(quote.normalize('NFKC').toLowerCase())) return quote
  const fragments = quote.split(/\r?\n/).map(part => part.trim()).filter(Boolean)
  if (fragments.length < 2 || fragments.length > 12) return quote
  const spans = [...current.matchAll(/[^\r\n]+/g)].filter(match => match[0].trim())
  const lines = spans.map(match => ({ content: match[0] }))
  let cursor = 0, first = -1, last = -1
  for (const fragment of fragments) {
    const index = lines.findIndex((line, i) => i >= cursor
      && text(line.content).normalize('NFKC').toLowerCase() === fragment.normalize('NFKC').toLowerCase())
    if (index < 0) return quote
    if (first < 0) first = index
    last = index; cursor = index + 1
  }
  // Keep all intervening messages, including negations and other declarations.
  return current.slice(spans[first].index, spans[last].index! + spans[last][0].length)
}

export function reconcileInformationalEvidence(raw: Row, current: string): Row {
  raw = reconcileEvidenceSources(raw, current)
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  const informational = ['project_information', 'ask_price', 'other'].includes(text(semantics.primary_intent))
    && ['none', 'search', 'details', 'compare', 'rank'].includes(text(property.operation))
  // Only a completed model recheck may certify a split selection's meaning.
  // Restore its entire source span, preserving intervening corrections. This
  // never repairs operational permission, monetary or identity evidence.
  const certifiedSelection = raw.recovery_outcome === 'repaired' && property.operation === 'select'
    && ['select_property', 'answer_previous', 'project_information', 'other'].includes(text(semantics.primary_intent))
  const selectionQuote = (value: unknown) => certifiedSelection
    ? informationalEvidenceQuote(formattedEvidenceQuote(value, current), current) : formattedEvidenceQuote(value, current)
  if (!informational) return { ...raw,
    requests: Array.isArray(raw.requests) ? raw.requests.map(value => {
      const request = object(value)
      return { ...request, evidence: request.domain === 'property' ? selectionQuote(request.evidence) : formattedEvidenceQuote(request.evidence, current) }
    }) : raw.requests,
    ...(raw.catalog_request ? { catalog_request: { ...object(raw.catalog_request), evidence: selectionQuote(object(raw.catalog_request).evidence) } } : {}),
    turn_semantics: { ...semantics, primary_evidence: selectionQuote(semantics.primary_evidence),
      property: { ...property, evidence: selectionQuote(property.evidence) } } }
  return { ...raw,
    requests: Array.isArray(raw.requests) ? raw.requests.map(value => {
      const request = object(value)
      return request.domain === 'property' ? { ...request, evidence: informationalEvidenceQuote(request.evidence, current) } : request
    }) : raw.requests,
    catalog_request: raw.catalog_request ? { ...object(raw.catalog_request),
      evidence: informationalEvidenceQuote(object(raw.catalog_request).evidence, current) } : raw.catalog_request,
    turn_semantics: { ...semantics,
      ...(semantics.selection_preferences ? { selection_preferences: { ...object(semantics.selection_preferences),
        priority: { ...object(object(semantics.selection_preferences).priority),
          evidence: informationalEvidenceQuote(object(object(semantics.selection_preferences).priority).evidence, current) } } } : {}),
      primary_evidence: informationalEvidenceQuote(semantics.primary_evidence, current),
      property: { ...property, evidence: informationalEvidenceQuote(property.evidence, current) } } }
}

export const CURRENT_EVIDENCE_FRAGMENTS_RULES = 'mensajes_actuales identifica los mensajes del turno actual con IDs. evidence_sources puede enlazar property, primary_intent, catalog_request o requests.N con esos IDs; [] si no hace falta. Para una elección cite todos los mensajes consecutivos que la fundamentan, incluidos los intermedios. Lea el turno completo: una negación, corrección posterior o condición puede revocar una elección anterior. No convierta «me gusta» en una selección ni «el de tres» en baños o dormitorios sin referente inequívoco. Los IDs solo reconstruyen citas; no autorizan dinero, identidad, reservas, visitas ni permisos. Esos bloques mantienen evidencia literal y sus contratos. Una reparación de citas conserva los demás bloques válidos y la interpretación, salvo que el turno completo contradiga la propuesta inicial. budget.subject distingue total_budget de down_payment; una entrada no definida no retira ni modifica el presupuesto total.'
