/**
 * Lane de entrega CAPI: sin fallback implícito a `live` fuera de producción.
 * Local / Preview / Development → siempre `test` (no consumible por drain live).
 */
export type MetaDeliveryLane = 'test' | 'live'

export function isProductionMetaRuntime(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  return String(env.VERCEL_ENV || '')
    .trim()
    .toLowerCase() === 'production'
}

/**
 * Resuelve la lane al persistir/flush.
 * - Fuera de Vercel production: siempre `test`.
 * - En production: META_CAPI_DELIVERY_LANE o META_MODE=test → test; si no → live.
 */
export function resolveDeliveryLane(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MetaDeliveryLane {
  if (!isProductionMetaRuntime(env)) {
    return 'test'
  }
  const explicit = String(env.META_CAPI_DELIVERY_LANE || '')
    .trim()
    .toLowerCase()
  if (explicit === 'test' || explicit === 'live') return explicit
  const mode = String(env.META_MODE || '')
    .trim()
    .toLowerCase()
  if (mode === 'test') return 'test'
  return 'live'
}
