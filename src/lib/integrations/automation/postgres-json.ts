export type PostgresJsonDiagnostics = {
  sanitized_strings: number
  sanitized_keys: number
  invalid_codepoints: number
  paths: string[]
}

/** These errors contain a structural path, never the original text or key. */
export class PostgresUnicodeError extends Error {
  constructor(readonly code: 'POSTGRES_INVALID_TEXT' | 'POSTGRES_JSON_KEY_COLLISION'
    | 'POSTGRES_JSON_CYCLE' | 'POSTGRES_JSON_UNSUPPORTED_VALUE', readonly path: string) {
    super(code)
    this.name = 'PostgresUnicodeError'
  }
}

const highSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff
const lowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff
const literalEscape = (code: number) => '\\u' + code.toString(16).padStart(4, '0')

/** PostgreSQL jsonb cannot store NUL or isolated UTF-16 surrogate units.
 * Keep an explicit visible representation instead of deleting them; deleting
 * a character between digits could change the meaning of a financial value. */
export function postgresSafeText(value: string): { value: string; invalidCodepoints: number } {
  let result = '', invalidCodepoints = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (highSurrogate(code) && lowSurrogate(value.charCodeAt(index + 1))) {
      result += value.slice(index, index + 2); index++
    } else if (code === 0 || highSurrogate(code) || lowSurrogate(code)) {
      result += literalEscape(code); invalidCodepoints++
    } else result += value[index]
  }
  return { value: result, invalidCodepoints }
}

/** Length limits are in UTF-16 code units, but must not bisect a valid pair. */
export function truncateUnicode(value: string, maxCodeUnits: number): string {
  let limit = Number.isFinite(maxCodeUnits) ? Math.max(0, Math.floor(maxCodeUnits)) : value.length
  if (limit >= value.length) return value
  if (limit > 0 && highSurrogate(value.charCodeAt(limit - 1)) && lowSurrogate(value.charCodeAt(limit))) limit--
  return value.slice(0, limit)
}

/** Customer-facing content is checked, never silently rewritten by telemetry
 * preparation. Call before any provider write or message launch. */
export function assertPostgresText(value: string, field = 'reply'): void {
  if (postgresSafeText(value).invalidCodepoints) {
    const safeField = /^[a-z_][a-z0-9_]{0,79}$/i.test(field) ? field : 'text'
    throw new PostgresUnicodeError('POSTGRES_INVALID_TEXT', '$.' + safeField)
  }
}

/** Make a fresh JSON-compatible tree before any external delivery. Diagnostics
 * identify positions rather than arbitrary property names, which may be PII.
 * Colliding escaped keys fail atomically rather than dropping either value. */
export function preparePostgresJson(input: unknown): { value: unknown; diagnostics: PostgresJsonDiagnostics } {
  const diagnostics: PostgresJsonDiagnostics = { sanitized_strings: 0, sanitized_keys: 0,
    invalid_codepoints: 0, paths: [] }
  const stack = new WeakSet<object>()
  const record = (path: string, count: number, key: boolean) => {
    if (!count) return
    diagnostics.invalid_codepoints += count
    if (key) diagnostics.sanitized_keys++; else diagnostics.sanitized_strings++
    if (diagnostics.paths.length < 40) diagnostics.paths.push(path)
  }
  function copy(value: unknown, path: string, arrayItem = false): unknown {
    if (typeof value === 'string') {
      const result = postgresSafeText(value)
      record(path, result.invalidCodepoints, false)
      return result.value
    }
    if (value === null || typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return arrayItem ? null : undefined
    if (typeof value !== 'object') throw new PostgresUnicodeError('POSTGRES_JSON_UNSUPPORTED_VALUE', path)
    if (stack.has(value)) throw new PostgresUnicodeError('POSTGRES_JSON_CYCLE', path)
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new PostgresUnicodeError('POSTGRES_JSON_UNSUPPORTED_VALUE', path)
    }
    stack.add(value)
    try {
      if (Array.isArray(value)) return Array.from(value, (item, index) => copy(item, `${path}[${index}]`, true))
      const keys = new Set<string>(), entries: [string, unknown][] = []
      for (const [index, [key, item]] of Object.entries(value).entries()) {
        const fieldPath = `${path}[field#${index}]`, preparedKey = postgresSafeText(key)
        record(fieldPath + '.key', preparedKey.invalidCodepoints, true)
        if (keys.has(preparedKey.value)) throw new PostgresUnicodeError('POSTGRES_JSON_KEY_COLLISION', fieldPath + '.key')
        keys.add(preparedKey.value)
        const prepared = copy(item, fieldPath + '.value')
        if (prepared !== undefined) entries.push([preparedKey.value, prepared])
      }
      return Object.fromEntries(entries)
    } finally { stack.delete(value) }
  }
  const value = copy(input, '$')
  if (value === undefined) throw new PostgresUnicodeError('POSTGRES_JSON_UNSUPPORTED_VALUE', '$')
  return { value, diagnostics }
}
