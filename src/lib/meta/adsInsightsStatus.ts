/**
 * Ads Insights (gasto, impresiones, clics, resultados Meta).
 * Distinto de CAPI: requiere token Marketing con ads_read + cuenta publicitaria.
 */
import {
  adsMarketingMissingHints,
  readAdsMarketingCredentials,
} from '@/lib/meta/adsMarketingClient'

export type AdsInsightsStatus =
  | {
      connected: true
      message: string
      adAccountId: string
      missing: []
      note: string
    }
  | {
      connected: false
      message: 'Datos publicitarios no disponibles'
      missing: string[]
      note: string
    }

export function getAdsInsightsStatus(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): AdsInsightsStatus {
  const creds = readAdsMarketingCredentials(env)
  if (creds) {
    return {
      connected: true,
      message: 'Credenciales Marketing API presentes (ads_read pendiente de verificar en Graph)',
      adAccountId: creds.adAccountId,
      missing: [],
      note:
        'Gasto y jerarquía ad→adset→campaign usan META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID. No reutilizan tokens CAPI Pixel ni WhatsApp. Aceptación Graph CAPI ≠ atribución a campaña.',
    }
  }
  return {
    connected: false,
    message: 'Datos publicitarios no disponibles',
    missing: adsMarketingMissingHints(env),
    note:
      'Paso: Meta Business Suite → Configuración → Usuarios del sistema → System User con acceso a la cuenta publicitaria (ads_read) → generar token → en Vercel Production (server-only) definir META_AD_ACCOUNT_ID=act_… y META_ADS_ACCESS_TOKEN (no pegar el token en chats). No reutilizar META_CAPI_* ni META_WA_CAPI_*. Redeploy tras guardar.',
  }
}
