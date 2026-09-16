/**
 * Consentimiento publicitario efectivo para Meta CAPI.
 * La casilla de contacto/privacidad del formulario NO entra aquí.
 *
 * - Cookie debe permitir ads (`full`).
 * - Si el ledger del visitante tiene revocación vigente, gana el ledger
 *   (evita cookie stale `full` tras un revoke).
 */
export function resolveEffectiveAdsConsent(opts: {
  cookieAllowsAds: boolean
  /** Último ads_consent del ledger para el visitor_key; null = sin historial */
  ledgerAdsConsent: boolean | null
}): boolean {
  if (!opts.cookieAllowsAds) return false
  if (opts.ledgerAdsConsent === false) return false
  return true
}
