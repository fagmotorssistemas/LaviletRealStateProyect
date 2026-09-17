/**
 * Controles Schedule (todos OFF por defecto).
 * Sin flags: ninguna escritura Schedule (intent/outbox).
 */

export const LOCAL_PERSIST_INACTIVE = 'local_persist_inactive_review' as const
export const FLUSH_NEST_INACTIVE = 'flush_nest_inactive' as const
export const DELIVERY_PIPELINE_INACTIVE = 'schedule_delivery_pipeline_inactive' as const
export const PROMOTE_REQUIRES_REVALIDATION = 'promote_requires_revalidation' as const
export const HISTORICAL_REVIEW_HOLD_NOT_AUTO_PROMOTED =
  'historical_review_hold_not_auto_promoted' as const
export const ALL_SCHEDULE_CONTROLS_OFF = 'all_schedule_controls_off' as const

/** Persistencia review_hold + registro de intent. Default off. */
export function isScheduleLocalPersistEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_LOCAL_PERSIST || '')
    .trim()
    .toLowerCase() === 'true'
}

/**
 * Entrega efectiva (promote→pending + flush FE + drain Nest Schedule).
 * Default off. Sin esto no se pasa a pending ni se drena Schedule.
 */
export function isScheduleDeliveryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_DELIVERY_ENABLED || '')
    .trim()
    .toLowerCase() === 'true'
}

/** Flush FE→Nest solo con delivery on + flush explícito. */
export function isScheduleFlushEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isScheduleDeliveryEnabled(env)) return false
  return String(env.META_SCHEDULE_FLUSH || '')
    .trim()
    .toLowerCase() === 'true'
}

/** Recover de intents faltantes. Default off. */
export function isScheduleRecoverEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(env.META_SCHEDULE_RECOVER_ENABLED || '')
    .trim()
    .toLowerCase() === 'true'
}

/** ¿Algún control permite escritura Schedule? */
export function isScheduleWritePathEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isScheduleLocalPersistEnabled(env) ||
    isScheduleDeliveryEnabled(env) ||
    isScheduleRecoverEnabled(env)
  )
}
