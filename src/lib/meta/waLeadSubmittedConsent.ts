import { normalized } from '@/lib/integrations/automation/sdr-rules'

/**
 * Consentimiento publicidad Meta/ads vía WhatsApp.
 * Distinto de tracking_consent (novedades). Iniciar chat no concede.
 * Nunca concede sobre texto del bot, citas ni negaciones ("no acepto…").
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
      // WhatsApp / correo: líneas citadas
      if (/^>/.test(t)) return false
      if (/^["«“].*["»”]$/.test(t) && t.length > 2) return false
      return true
    })
    .join(' ')
    .replace(/["«»“”][^"«»“”]{0,120}["«»“”]/g, ' ')
    .trim()

  if (!withoutQuotes) return null

  const m = normalized(withoutQuotes)
  // Atribución a bot / mensaje ajeno: no es afirmación del cliente.
  if (
    /(?:el bot|la ia|el asistente|ustedes dijeron|dijeron que|me pidieron que diga|repito).{0,40}(?:acepto|autorizo|consiento)/.test(
      m,
    )
  ) {
    return null
  }
  return withoutQuotes
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
  // Negaciones explícitas nunca conceden (aunque el resto mencione publicidad).
  if (/no (?:acepto|quiero|deseo|autorizo|consiento)/.test(m)) return false
  if (/(?:niego|rechazo).{0,20}(?:consentimiento|publicidad|anuncios)/.test(m)) {
    return false
  }
  return (
    /(?:acepto|autorizo|doy mi consentimiento).{0,40}(?:publicidad|anuncios|marketing|metas? ads|ofertas publicitarias)/.test(
      m,
    ) ||
    /(?:si|sí).{0,20}(?:pueden|pueden ustedes).{0,20}(?:usar|enviar).{0,30}(?:publicidad|anuncios)/.test(
      m,
    ) ||
    /consiento (?:el uso|que usen).{0,40}(?:publicidad|anuncios|datos para anuncios)/.test(m)
  )
}

export function detectsWhatsappAdsConsentRevoke(message: string): boolean {
  const m = normalized(message)
  if (!m) return false
  return (
    /(?:no (?:quiero|deseo|acepto|autorizo)|retiro (?:mi )?consentimiento).{0,40}(?:publicidad|anuncios|marketing|metas? ads)/.test(
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
  const utterance = clientAdsConsentUtterance(message)
  if (!utterance) return null
  return {
    message: utterance.slice(0, 500),
    scope: ADS_SCOPE,
    at: new Date().toISOString(),
    from: 'client_message',
  }
}
