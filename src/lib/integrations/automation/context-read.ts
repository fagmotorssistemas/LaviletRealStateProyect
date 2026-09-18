export type ContextReadResult = { data: unknown; error: unknown }
export type ContextReadSource = (attempt: number) => PromiseLike<ContextReadResult>

const errorCode = (source: string) => `COMMERCIAL_CONTEXT_${source.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_FAILED`

/**
 * Reads independent commercial sources together and retries only failed reads.
 * These operations are read-only, so retrying cannot duplicate a customer action.
 */
export async function readCommercialContext(
  sources: Record<string, ContextReadSource>,
  maxAttempts = 2,
) {
  const names = Object.keys(sources)
  const results: Record<string, ContextReadResult> = {}
  const attempts = Math.max(1, maxAttempts)

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pending = names.filter((name) => !results[name] || results[name].error)
    if (!pending.length) break
    const reads = await Promise.all(pending.map(async (name) => {
      try {
        return [name, await sources[name](attempt)] as const
      } catch (error) {
        return [name, { data: null, error }] as const
      }
    }))
    for (const [name, result] of reads) results[name] = result
  }

  const failed = names.find((name) => !results[name] || results[name].error)
  if (failed) throw new Error(errorCode(failed))
  return results
}

export function isCommercialContextReadFailure(reason: string) {
  return reason === 'COMMERCIAL_CONTEXT_FAILED'
    || reason === 'UNIT_CONTEXT_FAILED'
    || /^COMMERCIAL_CONTEXT_[A-Z0-9_]+_FAILED$/.test(reason)
}
