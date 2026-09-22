/**
 * Solicitud explícita de consentimiento whatsapp_ads (medición/publicidad Meta).
 *
 * No se envía automáticamente por el bot. Flujo utilizable:
 * 1. Bitácora CAPI / bloqueo `ads_consent_*` identifica el lead.
 * 2. Asesor copia el script desde Marketing → CAPI WhatsApp (o este módulo)
 *    y lo envía manualmente por Kommo.
 * 3. El cliente responde con la frase esperada →
 *    `applyWhatsappAdsConsentFromClientMessage` → RPC evidencia.
 * 4. Si hubo interés comercial sellado en la ventana (48h), la aceptación
 *    puede encolar sin otro mensaje comercial. La aceptación sola no es interés.
 *    No hay backfill indiscriminado de mensajes antiguos.
 *
 * Distinto de tracking_consent (novedades) del guion / drawer.
 */

export const WA_ADS_CONSENT_REQUEST_CHANNEL = 'advisor_manual_kommo' as const

/** Texto que el asesor envía (manual). Menciona Meta y el uso de datos. */
export const WA_ADS_CONSENT_REQUEST_SCRIPT =
  'Para mejorar nuestros anuncios en Meta (Facebook/Instagram), ¿nos autoriza a usar sus datos de este chat de WhatsApp solo para medición y publicidad de Meta? Si está de acuerdo, responda exactamente: «Acepto que usen mis datos para medición publicitaria de Meta».'

/** Respuesta del cliente que el detector concede (alcance whatsapp_ads). */
export const WA_ADS_CONSENT_EXPECTED_REPLY =
  'Acepto que usen mis datos para medición publicitaria de Meta'

export function waAdsConsentRequestBrief() {
  return {
    channel: WA_ADS_CONSENT_REQUEST_CHANNEL,
    botAutoSend: false as const,
    requestScript: WA_ADS_CONSENT_REQUEST_SCRIPT,
    expectedReply: WA_ADS_CONSENT_EXPECTED_REPLY,
    scope: 'whatsapp_ads' as const,
    notes: [
      'No sustituye tracking_consent ni cookies del showroom.',
      'Negaciones, preguntas y citas no conceden.',
      'Revocación cancela outbox pending/needs_review/review_hold antes del envío.',
      'Secuencia: interés → script manual → aceptación (reutiliza sello reciente; grant ≠ interés).',
    ],
  }
}
