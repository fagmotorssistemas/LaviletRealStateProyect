import 'server-only'

export class OpenAIRequestError extends Error {
  constructor(public status: number, public retryable: boolean, public attempts: number, code = '') {
    super(`OPENAI_${status ? `HTTP_${status}` : 'NETWORK_ERROR'}${code ? '_' + code.replace(/[^a-z0-9_]/gi, '').slice(0, 80).toUpperCase() : ''}`)
  }
}

type Dependencies = { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number; random: () => number }
const defaults: Dependencies = { fetch: (...args) => fetch(...args), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), now: Date.now, random: Math.random }

/** Retry only inference requests. Never wrap a conversation, database action or Kommo send. */
export async function requestOpenAI(url: string, init: RequestInit, dependencies: Partial<Dependencies> = {}) {
  const deps = { ...defaults, ...dependencies }, deadline = deps.now() + 45_000
  let failure = new OpenAIRequestError(0, true, 0)
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response | undefined
    try {
      response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, deadline - deps.now()))) })
    } catch {
      failure = new OpenAIRequestError(0, true, attempt)
    }
    let retryAfter = 0
    if (response) {
      if (response.ok) return response
      const payload = await response.json().catch(() => ({}))
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : ''
      const kind = typeof payload?.error?.type === 'string' ? payload.error.type : ''
      const billing = /quota|billing|credit|spend|usage_limit/i.test(code + ' ' + kind)
      const transient = [408, 500, 502, 503, 504].includes(response.status)
        || (response.status === 429 && !billing && /rate_limit|slow_down/i.test(code + ' ' + kind))
      failure = new OpenAIRequestError(response.status, transient && !billing, attempt, code)
      if (!failure.retryable) throw failure
      const header = response.headers.get('retry-after')
      if (header) retryAfter = /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : Math.max(0, Date.parse(header) - deps.now()) || 0
    }
    const wait = Math.max(retryAfter, 750 * 2 ** (attempt - 1) + Math.floor(deps.random() * 250))
    // Respect Retry-After; do not shorten a provider-requested wait to force another request.
    if (attempt === 3 || deps.now() + wait + 1000 >= deadline) throw failure
    await deps.sleep(wait)
  }
  throw failure
}
