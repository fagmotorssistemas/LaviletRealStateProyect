import { object, text, type Row } from './data'

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
  const semantics = object(raw.turn_semantics), property = object(semantics.property)
  const informational = ['project_information', 'ask_price', 'other'].includes(text(semantics.primary_intent))
    && ['none', 'search', 'details', 'compare', 'rank'].includes(text(property.operation))
  if (!informational) return raw
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

export const CURRENT_EVIDENCE_FRAGMENTS_RULES = 'mensajes_actuales identifica los fragmentos del turno actual en orden. Una evidencia puede citar un solo fragmento literal o varios mensajes completos separados por salto de línea, conservando su orden. No una palabras sueltas ni cambie la ortografía; el sistema conserva el tramo fuente con sus mensajes intermedios. Para presupuesto, permisos, selección y acciones use su evidencia literal continua y el contrato de autorización correspondiente. Una reparación de citas conserva la interpretación y los demás bloques que ya eran válidos.'
