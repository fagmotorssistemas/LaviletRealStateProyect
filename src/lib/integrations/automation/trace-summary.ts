type Summary = Record<string, unknown>

const internalIdKey = /^(?:id|policy_id|batch_id|batch_event_ids|event_id|event_ids|conversation_id|lead_id|unit_id|unit_ids|candidate_unit_ids|selected_unit_ids|result_unit_ids|reference_unit_ids|target_ids|candidate_ids|focused_ids|offered_ids|comparison_ids)$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const replyTextKey = /^(?:(?:base|proposed|final|approved|candidate|response|rejected)_preview|(?:approved|candidate|final|policy)_text|policy_content|before|after)$/

const privateKey = /^(?:.*_)?(?:authorization|password|secret|token|api_key|access_token|refresh_token|phone|telefono|mobile|email|correo|cedula|dni|identificacion|national_id|full_name|legal_name|given_names|surnames|financing_identity|document|ruc|job_title|employment_stability_months|account_number|numero_cuenta|salary|salario|sueldo|income|ingresos|employer|empleador|financial_documents|personal_data)$/i

/** Audit previews are deliberately smaller than the protected conversation history. */
export function traceText(value: unknown, max = 360) {
  const content = typeof value === 'string' ? value : ''
  return content
    .replace(/https?:\/\/[^\s<>]+/gi, raw => {
      try {
        const url = new URL(raw)
        return `${url.origin}${url.pathname}${url.search ? ' [parámetros protegidos]' : ''}`
      } catch { return '[enlace protegido]' }
    })
    .replace(/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, '[credencial protegida]')
    .replace(/[\w.+-]{1,64}@[\w.-]{1,253}\.[A-Za-z]{2,63}/g, '[correo protegido]')
    .replace(/(?:\+?\d[\s().-]*){10,}/g, '[dato protegido]')
    .replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Apply on write and read, including legacy summaries. Never log provider bodies. */
export function sanitizeTraceSummary(value: unknown): Summary {
  const seen = new WeakSet<object>()
  function clean(input: unknown, depth: number, key = ''): unknown {
    if (key === 'prompt_snapshot' || key === 'output_snapshot') return sanitizePromptSnapshot(input)
    if (privateKey.test(key)) return '[dato protegido]'
    if (input === null || typeof input === 'boolean') return input
    if (typeof input === 'number') return Number.isFinite(input) ? input : null
    // Opaque database IDs link the actual execution and its catalogue results.
    // Preserve only exact UUIDs in these fields; arbitrary text still needs redaction.
    if (typeof input === 'string') return internalIdKey.test(key) && uuid.test(input) ? input : traceText(input, replyTextKey.test(key) ? 3000 : 1500)
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
  const row = value && typeof value === 'object' ? value as Summary : {}
  const version = row.capture_version === 2 ? 2 : null
  let remaining = version ? 1_000_000 : 120000
  let limited = false
  let filtered = row.privacy_filtered === true || !version
  const seen = new WeakSet<object>()
  function clean(input: unknown, depth = 0, key = '', schema = false): unknown {
    if (!schema && privateKey.test(key)) { filtered = true; return '[dato protegido]' }
    if (remaining <= 0 || depth > 20) { limited = true; return '[resumen limitado]' }
    if (typeof input === 'string') {
      // Preserve Markdown indentation and literal whitespace in the captured prompt.
      const protectedText = input
        .replace(/\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]+/gi, '[credencial protegida]')
        .replace(/[\w.+-]{1,64}@[\w.-]{1,253}\.[A-Za-z]{2,63}/g, '[correo protegido]')
        .replace(/(?:\+?\d[\s().-]*){10,}/g, '[dato protegido]')
        .replace(/https?:\/\/[^\s<>]+/gi, raw => {
          try { const url = new URL(raw); return url.search ? `${url.origin}${url.pathname} [parámetros protegidos]` : raw }
          catch { return raw }
        })
      filtered ||= protectedText !== input
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
    if (Array.isArray(input)) return input.slice(0, 300).map(item => clean(item, depth + 1, key, schema))
    return Object.fromEntries(entries.slice(0, 300).map(([name, item]) => [name.slice(0, 80), clean(item, depth + 1, name, schema || name === 'response_schema')]))
  }
  const result = clean({ instructions: row.instructions, user_prefix: row.user_prefix, data: row.data, response_schema: row.response_schema,
    ...(version ? { capture_version: version, request_parameters: row.request_parameters } : {}) }) as Summary
  return { ...result, privacy_filtered: filtered, limited: limited || row.limited === true }
}

export function traceErrorCode(error: unknown) {
  const candidate = error instanceof Error ? error.message : typeof error === 'string' ? error
    : error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  return /^[A-Z0-9_]{1,120}$/.test(candidate) ? candidate : 'PROCESSING_FAILED'
}
