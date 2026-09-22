/**
 * Ads Insights (gasto, impresiones, clics, conversaciones atribuidas por Meta).
 * No existe integración autorizada en este frontend: no inventar ceros.
 */

export type AdsInsightsStatus = {
  connected: false
  message: 'Métricas publicitarias no conectadas'
  missing: string[]
  note: string
}

export function getAdsInsightsStatus(): AdsInsightsStatus {
  return {
    connected: false,
    message: 'Métricas publicitarias no conectadas',
    missing: [
      'META_AD_ACCOUNT_ID (cuenta publicitaria autorizada)',
      'Token Marketing API con permiso ads_read (no reutilizar tokens de Pixel/Events ni exponerlos al navegador)',
      'Llamada server-side a Graph /{ad-account-id}/insights con métricas spend, impressions, clicks, actions',
      'Mapeo explícito campaña/anuncio ↔ conversaciones Meta (no inferir desde CRM ni source=WHATSAPP)',
    ],
    note:
      'Gasto, impresiones, clics y conversaciones atribuidas por Meta deben venir de Ads Insights. El CRM y la cola CAPI no las sustituyen.',
  }
}
