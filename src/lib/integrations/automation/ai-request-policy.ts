import type { AIRequestRole } from './ai-model-routing'

export type AIRequestPolicy = {
  attemptTimeoutMs: number
  totalTimeoutMs: number
  maxAttempts: number
  minimumRetryWindowMs: number
}

/** Shared by production and the isolated evaluation harness. */
export function aiRequestPolicy(role?: AIRequestRole): AIRequestPolicy {
  return role === 'reviewer'
    ? { attemptTimeoutMs: 60_000, totalTimeoutMs: 125_000, maxAttempts: 2, minimumRetryWindowMs: 60_000 }
    : { attemptTimeoutMs: 30_000, totalTimeoutMs: 45_000, maxAttempts: 3, minimumRetryWindowMs: 1_000 }
}
