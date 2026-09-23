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
    .replace(/[\w.+-]{1,64}@[\w.-]{1,253}\.[A-Za-z]{2,63}/g, '[correo protegido]')
    .replace(/(?:\+?\d[\s().-]*){10,16}/g, '[dato protegido]')
    .replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Apply on write and read, including legacy summaries. Never log provider bodies. */
export function sanitizeTraceSummary(value: unknown): Summary {
  const seen = new WeakSet<object>()
  function clean(input: unknown, depth: number, key = ''): unknown {
    if (key === 'prompt_snapshot' || key === 'output_snapshot') return sanitizePromptSnapshot(input)
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

/** Bounded, privacy-filtered writer input; kept separately from abbreviated previews. */
export function sanitizePromptSnapshot(value: unknown): Summary {
  let remaining = 120000
  let limited = false
  const seen = new WeakSet<object>()
  function clean(input: unknown, depth = 0, key = ''): unknown {
    if (privateKey.test(key) || /budget|presupuesto|initial_capital|capital_inicial/i.test(key)) return '[dato protegido]'
    if (remaining <= 0 || depth > 20) { limited = true; return '[resumen limitado]' }
    if (typeof input === 'string') {
      if (input.length > 120000) limited = true
      const protectedText = input.split('\n').map(line => traceText(line, 120000)).join('\n')
      const result = protectedText.slice(0, remaining)
      limited ||= result.length < protectedText.length
      remaining -= result.length
      return result
    }
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : null
    if (!input || typeof input !== 'object') return null
    if (seen.has(input)) { limited = true; return '[resumen limitado]' }
    seen.add(input)
    const entries = Object.entries(input)
    if (entries.length > 300) limited = true
    if (Array.isArray(input)) return input.slice(0, 300).map(item => clean(item, depth + 1, key))
    return Object.fromEntries(entries.slice(0, 300).map(([name, item]) => [name.slice(0, 80), clean(item, depth + 1, name)]))
  }
  const row = value && typeof value === 'object' ? value as Summary : {}
  const result = clean({ instructions: row.instructions, user_prefix: row.user_prefix, data: row.data, response_schema: row.response_schema }) as Summary
  return { ...result, privacy_filtered: true, limited: limited || row.limited === true }
}

export function traceErrorCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /^[A-Z0-9_]{1,120}$/.test(candidate) ? candidate : 'PROCESSING_FAILED'
}
