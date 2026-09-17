/**
 * Controles Schedule (todos OFF por defecto).
 * Pipeline web completo existe en código; no envía sin flags explícitos.
 */

export const LOCAL_PERSIST_INACTIVE = 'local_persist_inactive_review' as const
export const FLUSH_NEST_INACTIVE = 'flush_nest_inactive' as const
export const DELIVERY_PIPELINE_INACTIVE = 'schedule_delivery_pipeline_inactive' as const
export const PROMOTE_REQUIRES_REVALIDATION = 'promote_requires_revalidation' as const
export const HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED =
  'historical_review_hold_not_auto_promoted' as const

/** Persistencia review_hold (revisión). Default off. */
export function isScheduleLocalPersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_LOCAL_PERSIST || '')
    .trim()
    .toLowerCase() === 'true'
}

/**
 * Pipeline web hasta Nest (promote explícito de la cita actual + flush).
 * Default off. No promueve review_hold históricos en lote.
 */
export function isScheduleDeliveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_DELIVERY_ENABLED || '')
    .trim()
    .toLowerCase() === 'true'
}

/**
 * Flush outbox→Nest solo si delivery está on Y flush explícito.
 * Default off aunque META_SCHEDULE_FLUSH=true (doble candado).
 */
export function isScheduleFlushEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isScheduleDeliveryEnabled(env)) return false
  return String(env.META_SCHEDULE_FLUSH || '')
    .trim()
    .toLowerCase() === 'true'
}

/** Recover automático de intents faltantes (Nest drain / cron). Default off. */
export function isScheduleRecoverEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_RECOVER_ENABLED || '')
    .trim()
    .toLowerCase() === 'true'
}
