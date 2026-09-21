/**
 * Huellas explícitas de pruebas técnicas CRM↔CAPI.
 * Solo marcan el mensaje (kommo + contact + ventana horaria), no el contacto entero ni el anuncio.
 * No modifica datos de producción: catálogo en código.
 */
export type WaCrmTechnicalProbe = {
  id: string
  label: string
  kommoId: number
  contactId: number
  /** Inclusive ISO UTC */
  sentAtFrom: string
  /** Exclusive ISO UTC */
  sentAtTo: string
  note: string
}

/** 21/09/2026 09:52 America/Guayaquil = 14:52 UTC */
export const WA_CRM_TECHNICAL_PROBES: WaCrmTechnicalProbe[] = [
  {
    id: 'external_property_ad_2026-09-21_0952_ec',
    label: 'Prueba anuncio propiedad externa (21/09/2026 09:52 EC)',
    kommoId: 4453096,
    contactId: 9431328,
    sentAtFrom: '2026-09-21T14:52:00.000Z',
    sentAtTo: '2026-09-21T14:53:00.000Z',
    note:
      'Solo este inbound. No marca el contacto, la cuenta WhatsApp ni el anuncio completo; no implica interés en unidades La Vilet.',
  },
]

export function matchTechnicalProbeMessage(input: {
  kommoId: number | null | undefined
  contactId: number | string | null | undefined
  sentAt: string | null | undefined
  probes?: WaCrmTechnicalProbe[]
}): WaCrmTechnicalProbe | null {
  const kommoId = Number(input.kommoId)
  const contactId = Number(input.contactId)
  const sentAt = input.sentAt ? Date.parse(input.sentAt) : NaN
  if (!Number.isSafeInteger(kommoId) || kommoId <= 0) return null
  if (!Number.isSafeInteger(contactId) || contactId <= 0) return null
  if (!Number.isFinite(sentAt)) return null
  for (const probe of input.probes ?? WA_CRM_TECHNICAL_PROBES) {
    if (probe.kommoId !== kommoId || probe.contactId !== contactId) continue
    const from = Date.parse(probe.sentAtFrom)
    const to = Date.parse(probe.sentAtTo)
    if (sentAt >= from && sentAt < to) return probe
  }
  return null
}
