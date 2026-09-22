type Summary = Record<string, unknown>

const internalIdKey = /^(?:id|batch_id|batch_event_ids|event_id|event_ids|conversation_id|lead_id|unit_id|unit_ids|candidate_unit_ids|selected_unit_ids|result_unit_ids|reference_unit_ids|target_ids|candidate_ids|focused_ids|offered_ids|comparison_ids)$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const privateKey = /^(?:.*_)?(?:authorization|password|secret|token|api_key|access_token|refresh_token|phone|telefono|mobile|email|correo|cedula|dni|identificacion|national_id|full_name|ruc|job_title|employment_stability_months|account_number|numero_cuenta|salary|salario|sueldo|income|ingresos|employer|empleador|financial_documents|personal_data)$/i
const privateFinancialText = /\b(?:mi[s]?\s+(?:ingresos?|sueldo|salario|c[eé]dula|cuenta|ahorros?|capital|presupuesto)|(?:c[eé]dula|dni|identificaci[oó]n|sueldo|salario|ingresos?\s+mensuales)\s*(?:es|son|de|:|n[uú]mero)?\s*[$\d])/i

/** Audit previews are deliberately smaller than the protected conversation history. */
export function traceText(value: unknown, max = 360) {
  const content = typeof value === 'string' ? value : ''
  if (privateFinancialText.test(content) || /\d/.test(content) && /\b(?:presupuesto|capital|ahorros|gano|dispongo|cuento con|tengo disponible)/i.test(content)) return '[contenido personal protegido]'
  return content
    .replace(/https?:\/\/[^\s<>]+/gi, raw => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}${url.search ? ' [parámetros protegidos]' : ''}`
      } catch { return '[enlace protegido]' }
    })
    .replace(/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, '[credencial protegida]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[correo protegido]')
    .replace(/(?:\+?\d[\s().-]*){10,16}/g, '[dato protegido]')
    .replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Apply on write and read, including legacy summaries. Never log provider bodies. */
export function sanitizeTraceSummary(value: unknown): Summary {
  const seen = new WeakSet<object>()
  function clean(input: unknown, depth: number, key = ''): unknown {
    if (privateKey.test(key) || /^(?:min_|max_)?(?:budget|presupuesto|initial_capital|capital_inicial)(?:_(?:amount|min|max|text|texto))?$/i.test(key)) return '[dato protegido]'
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : null
    // Opaque database IDs link the actual execution and its catalogue results.
    // Preserve only exact UUIDs in these fields; arbitrary text still needs redaction.
    if (typeof input === 'string') return internalIdKey.test(key) && uuid.test(input) ? input : traceText(input, 1000)
    if (!input || typeof input !== 'object') return null
    if (depth >= 6 || seen.has(input)) return '[resumen limitado]'
    seen.add(input)
    if (Array.isArray(input)) return input.slice(0, 40).map(item => clean(item, depth + 1, key))
    return Object.fromEntries(Object.entries(input).slice(0, 80)
      .map(([name, item]) => [name.slice(0, 80), clean(item, depth + 1, name)]))
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? clean(value, 0) as Summary : {}
}

export function traceErrorCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /^[A-Z0-9_]{1,120}$/.test(candidate) ? candidate : 'PROCESSING_FAILED'
}
