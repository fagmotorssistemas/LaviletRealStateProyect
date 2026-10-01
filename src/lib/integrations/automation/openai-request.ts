import 'server-only'
import { aiRequestPolicy, type AIRequestPolicy } from './ai-request-policy'

type FailureKind = 'timeout' | 'network' | 'http' | 'invalid_response' | 'cancelled'
type Attempt = {
  attempt: number; timeout_ms: number; duration_ms: number
  phase: 'request' | 'response_body'; outcome: 'succeeded' | FailureKind
  http_status?: number; provider_code?: string; retryable?: boolean
}
export type OpenAIRequestDiagnostics = {
  policy: AIRequestPolicy; attempts: Attempt[]; total_ms: number
  stop_reason: 'completed' | 'max_attempts' | 'deadline' | 'non_retryable' | 'cancelled' | 'guard_failed'
}
const safeCode = (code: string) => code.replace(/[^a-z0-9_]/gi, '').slice(0, 80).toUpperCase()
export class AIRequestGuardError extends Error {
  constructor() { super('AI_REQUEST_GUARD_FAILED') }
}
export class OpenAIRequestError extends Error {
  public diagnostics?: OpenAIRequestDiagnostics
  constructor(public status: number, public retryable: boolean, public attempts: number, code = '',
    public kind: FailureKind = status ? 'http' : 'network') {
    const prefix = status ? `HTTP_${status}` : kind === 'timeout' ? 'TIMEOUT'
      : kind === 'cancelled' ? 'CANCELLED' : kind === 'invalid_response' ? 'INVALID_RESPONSE_BODY' : 'NETWORK_ERROR'
    super(`OPENAI_${prefix}${code ? '_' + safeCode(code) : ''}`)
  }
}

type Dependencies = {
  fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number; random: () => number
  timeoutSignal: (ms: number) => AbortSignal
}
type Options = {
  policy?: AIRequestPolicy
  deadlineAt?: number
  beforeAttempt?: () => Promise<void>
  onDiagnostics?: (diagnostics: OpenAIRequestDiagnostics) => void
}
const defaults: Dependencies = { fetch: (...args) => fetch(...args), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: Date.now, random: Math.random, timeoutSignal: ms => AbortSignal.timeout(ms) }

/** Retry only the same inference request, never the conversation or a CRM action. */
export async function requestOpenAI(url: string, init: RequestInit, dependencies?: Partial<Dependencies>, readResponse?: undefined, options?: Options): Promise<Response>
export async function requestOpenAI<T>(url: string, init: RequestInit, dependencies: Partial<Dependencies>, readResponse: (response: Response) => Promise<T>, options?: Options): Promise<T>
export async function requestOpenAI<T>(url: string, init: RequestInit, dependencies: Partial<Dependencies> = {}, readResponse?: (response: Response) => Promise<T>, options: Options = {}): Promise<Response | T> {
  const deps = { ...defaults, ...dependencies }, policy = options.policy || aiRequestPolicy(), started = deps.now()
  const deadline = Math.min(started + policy.totalTimeoutMs, options.deadlineAt ?? Infinity)
  const diagnostics: OpenAIRequestDiagnostics = { policy, attempts: [], total_ms: 0, stop_reason: 'deadline' }
  let failure = new OpenAIRequestError(0, true, 0, '', 'timeout')
  const stop = (reason: OpenAIRequestDiagnostics['stop_reason']): never => {
    diagnostics.stop_reason = reason
    failure.diagnostics = diagnostics
    throw failure
  }
  try {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      if (init.signal?.aborted) {
        failure = new OpenAIRequestError(0, false, diagnostics.attempts.length, '', 'cancelled')
        stop('cancelled')
      }
      if (deps.now() >= deadline) stop('deadline')
      // Renew the worker lease before a potentially long inference. A lost lease
      // is not an OpenAI failure and must never trigger retries or advisor sends.
      try { await options.beforeAttempt?.() } catch { diagnostics.stop_reason = 'guard_failed'; throw new AIRequestGuardError() }
      if (deps.now() >= deadline) stop('deadline')
      if (attempt > 1 && deadline - deps.now() < policy.minimumRetryWindowMs) stop('deadline')
      const timeoutMs = Math.max(1, Math.min(policy.attemptTimeoutMs, deadline - deps.now()))
      const timeout = deps.timeoutSignal(timeoutMs)
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
      const attemptStarted = deps.now()
      let response: Response | undefined, retryAfter = 0
      const detail: Attempt = { attempt, timeout_ms: timeoutMs, duration_ms: 0, phase: 'request', outcome: 'network' }
      diagnostics.attempts.push(detail)
      try {
        response = await deps.fetch(url, { ...init, signal })
        detail.http_status = response.status
        detail.phase = 'response_body'
        if (response.ok) {
          // Consume the body under the SAME timeout; a 200 header is not a result.
          const result = readResponse ? await readResponse(response) : response
          detail.outcome = 'succeeded'
          diagnostics.stop_reason = 'completed'
          return result
        }
        let payload
        try { payload = await response.json() } catch (error) {
          // HTML/non-JSON gateway errors still retain their HTTP status. A stalled
          // error body must not turn authentication/billing failures into retries.
          if (!response.status || response.status >= 500 || response.status === 408) {
            if (!(error instanceof SyntaxError)) throw error
          }
        }
        const code = typeof payload?.error?.code === 'string' ? payload.error.code : ''
        const kind = typeof payload?.error?.type === 'string' ? payload.error.type : ''
        const billing = /quota|billing|credit|spend|usage_limit/i.test(code + ' ' + kind)
        const transient = [408, 500, 502, 503, 504].includes(response.status)
          || (response.status === 429 && !billing && /rate_limit|slow_down/i.test(code + ' ' + kind))
        failure = new OpenAIRequestError(response.status, transient && !billing, attempt, code)
        detail.provider_code = safeCode(code)
        const header = response.headers.get('retry-after')
        if (header) retryAfter = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - deps.now()) || 0
      } catch (error) {
        const name = error instanceof Error ? error.name : ''
        const cancelled = init.signal?.aborted === true
        const timedOut = !cancelled && (timeout.aborted || name === 'TimeoutError' || name === 'AbortError')
        const invalid = !cancelled && !timedOut && detail.phase === 'response_body' && name !== 'TypeError'
        failure = new OpenAIRequestError(0, !cancelled && !invalid, attempt,
          detail.phase === 'response_body' && !invalid ? 'RESPONSE_BODY' : '',
          cancelled ? 'cancelled' : timedOut ? 'timeout' : invalid ? 'invalid_response' : 'network')
      } finally { detail.duration_ms = Math.max(0, deps.now() - attemptStarted) }
      detail.outcome = failure.kind
      detail.retryable = failure.retryable
      if (!failure.retryable) stop(failure.kind === 'cancelled' ? 'cancelled' : 'non_retryable')
      if (attempt === policy.maxAttempts) stop('max_attempts')
      const wait = Math.max(retryAfter, 750 * 2 ** (attempt - 1) + Math.floor(deps.random() * 250))
      // Never shorten Retry-After or start a reviewer retry with a tiny leftover
      // window. Its second attempt needs the same processing time as its first.
      if (deps.now() + wait + policy.minimumRetryWindowMs > deadline) stop('deadline')
      await deps.sleep(wait)
    }
    return stop('max_attempts')
  } finally {
    diagnostics.total_ms = Math.max(0, deps.now() - started)
    options.onDiagnostics?.(diagnostics)
  }
}
