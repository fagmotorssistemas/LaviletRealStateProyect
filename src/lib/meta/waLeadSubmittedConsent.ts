import { normalized } from '@/lib/integrations/automation/sdr-rules'

/**
 * Consentimiento publicidad Meta/ads vía WhatsApp (alcance whatsapp_ads).
 * Distinto de tracking_consent (novedades) y de contacto comercial.
 * Iniciar chat no concede. No convierte frases genéricas en consentimiento amplio.
 *
 * Debe apuntar a medición/publicidad con Meta (anuncios), no a «acepto
 * publicidad» genérico del proyecto.
 */

const ADS_SCOPE = 'whatsapp_ads' as const

export const WA_ADS_CONSENT_SCOPE = ADS_SCOPE

/** Quita citas/réplicas y atribuciones a terceros antes de evaluar grant. */
export function clientAdsConsentUtterance(message: string): string | null {
  const raw = String(message || '').trim()
  if (!raw) return null

  const withoutQuotes = raw
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim()
      if (!t) return false
      if (/^>/.test(t)) return false
      if (/^["«“].*["»”]$/.test(t) && t.length > 2) return false
      return true
    })
    .join(' ')
    .replace(/["«»“”][^"«»“”]{0,120}["«»“”]/g, ' ')
    .trim()

  if (!withoutQuotes) return null

  const m = normalized(withoutQuotes)
  if (
    /(?:el bot|la ia|el asistente|ustedes dijeron|dijeron que|me pidieron que diga|repito).{0,40}(?:acepto|autorizo|consiento)/.test(
      m,
    )
  ) {
    return null
  }
  return withoutQuotes
}

/** Señales de Meta / medición publicitaria (no «publicidad» genérica sola). */
function mentionsMetaAdsMeasurement(m: string): boolean {
  return (
    /meta(?:\s+ads)?|facebook|instagram|pixel|capi|conversiones|medici[oó]n publicitaria|anuncios (?:de |en )?(?:meta|facebook|instagram)|publicidad (?:de |en )?(?:meta|facebook|instagram)|datos para (?:anuncios|publicidad|medici[oó]n)/.test(
      m,
    ) || /metas? ads/.test(m)
  )
}

export function detectsWhatsappAdsConsentGrant(
  message: string,
  opts?: { fromBot?: boolean },
): boolean {
  if (opts?.fromBot === true) return false
  const utterance = clientAdsConsentUtterance(message)
  if (!utterance) return false
  const m = normalized(utterance)
  if (!m) return false
  if (/no (?:acepto|quiero|deseo|autorizo|consiento)/.test(m)) return false
  if (/(?:niego|rechazo).{0,20}(?:consentimiento|publicidad|anuncios|meta)/.test(m)) {
    return false
  }
  // Frase genérica «acepto publicidad» sin Meta/medición → no concede whatsapp_ads.
  if (!mentionsMetaAdsMeasurement(m)) return false

  return (
    /(?:acepto|autorizo|doy mi consentimiento|consiento).{0,60}(?:publicidad|anuncios|marketing|medici[oó]n|datos|meta|facebook|instagram)/.test(
      m,
    ) ||
    /(?:si|sí).{0,20}(?:pueden|pueden ustedes).{0,30}(?:usar|enviar|medir).{0,40}(?:publicidad|anuncios|datos|meta)/.test(
      m,
    )
  )
}

export function detectsWhatsappAdsConsentRevoke(message: string): boolean {
  const m = normalized(message)
  if (!m) return false
  return (
    /(?:no (?:quiero|deseo|acepto|autorizo)|retiro (?:mi )?consentimiento).{0,40}(?:publicidad|anuncios|marketing|metas? ads|meta|medici[oó]n)/.test(
      m,
    ) || /(?:dejar de|dejen de) (?:enviarme|mandarme).{0,20}(?:publicidad|anuncios)/.test(m)
  )
}

export type WaAdsConsentEvidence = {
  message: string
  scope: typeof ADS_SCOPE
  at: string
  from: 'client_message'
}

export function buildWaAdsConsentEvidence(message: string): WaAdsConsentEvidence | null {
  if (!detectsWhatsappAdsConsentGrant(message)) return null
  const utterance = clientAdsConsentUtterance(message)
  if (!utterance) return null
  return {
    message: utterance.slice(0, 500),
    scope: ADS_SCOPE,
    at: new Date().toISOString(),
    from: 'client_message',
  }
}
