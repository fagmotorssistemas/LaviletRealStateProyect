/**
 * CTWA / ctwa_clid desde el webhook CRM de Kommo (WhatsApp → Kommo → CRM).
 *
 * Reglas:
 * - No exige ctwa_clid: un mensaje sin él sigue el flujo habitual.
 * - No inventa atribución a anuncios ni a orgánico si Kommo no entrega el dato.
 * - Si llega ctwa_clid, se conserva (first-touch) con su origen de campo.
 * - Meta Cloud API sí envía referral.ctwa_clid en el primer mensaje; el webhook
 *   CRM documentado de Kommo (message[add]) no declara ese bloque. Si Kommo no
 *   lo reenvía, no se puede inventar aquí.
 */

export type CtwaCapture = {
  /** Click ID de Click-to-WhatsApp, si Kommo lo reenvió. */
  clid: string
  /** Ruta/campo del payload donde se leyó (trazabilidad). */
  fieldPath: string
  sourceId: string | null
  sourceUrl: string | null
  /** Solo si el payload lo trae explícitamente (p. ej. referral.source_type=ad). */
  referralSourceType: string | null
}

export type CtwaStored = CtwaCapture & {
  contactId: number
  kommoId: number
  externalMessageId: string
  capturedAt: string
}

const CLID_MAX = 512
const PATH_MAX = 300

/** Claves conocidas bajo message[add][i]… (form/JSON aplanado). */
const KNOWN_CLID_SUFFIXES = [
  'referral][ctwa_clid',
  'referral][ctwaClid',
  'ctwa_clid',
  'ctwaClid',
  'metadata][ctwa_clid',
  'metadata][ctwaClid',
  'params][ctwa_clid',
]

function cleanClid(raw: string): string | null {
  const value = String(raw ?? '').trim()
  if (!value || value.length > CLID_MAX) return null
  // Evitar inventar desde placeholders.
  if (/^(null|undefined|none|n\/a)$/i.test(value)) return null
  return value
}

function getFlat(flat: Record<string, string>, index: string, suffix: string): string {
  return flat[`message[add][${index}][${suffix}]`] || ''
}

/**
 * Extrae ctwa_clid si aparece en el payload Kommo aplanado.
 * No marca ads/orgánico: solo reporta lo que venga en el mensaje.
 */
export function extractCtwaFromKommoFlat(
  flat: Record<string, string>,
  index: string,
): CtwaCapture | null {
  const prefix = `message[add][${index}]`
  let clid: string | null = null
  let fieldPath: string | null = null

  for (const suffix of KNOWN_CLID_SUFFIXES) {
    const value = cleanClid(getFlat(flat, index, suffix))
    if (value) {
      clid = value
      fieldPath = `${prefix}[${suffix}]`.slice(0, PATH_MAX)
      break
    }
  }

  if (!clid) {
    // Barrido: cualquier clave del mensaje que termine en ctwa_clid / ctwaClid.
    for (const [key, raw] of Object.entries(flat)) {
      if (!key.startsWith(`${prefix}[`)) continue
      if (!/\[ctwa_clid\]$|\[ctwaClid\]$/i.test(key)) continue
      const value = cleanClid(raw)
      if (!value) continue
      clid = value
      fieldPath = key.slice(0, PATH_MAX)
      break
    }
  }

  if (!clid || !fieldPath) return null

  const sourceId =
    cleanClid(getFlat(flat, index, 'referral][source_id')) ||
    cleanClid(getFlat(flat, index, 'referral][sourceId')) ||
    null
  const sourceUrl =
    (getFlat(flat, index, 'referral][source_url') || getFlat(flat, index, 'referral][sourceUrl') || '')
      .trim()
      .slice(0, 2000) || null
  const referralSourceType =
    (getFlat(flat, index, 'referral][source_type') || getFlat(flat, index, 'referral][sourceType') || '')
      .trim()
      .slice(0, 64) || null

  return {
    clid,
    fieldPath,
    sourceId,
    sourceUrl,
    referralSourceType,
  }
}

/**
 * First-touch: conserva el primer clid y su origen.
 * Un mensaje posterior sin CTWA no borra ni reemplaza la captura previa.
 * Reintentos con el mismo clid son idempotentes.
 */
export function preserveCtwaCapture(
  existing: CtwaCapture | null | undefined,
  incoming: CtwaCapture | null | undefined,
): CtwaCapture | null {
  if (existing?.clid) return existing
  if (incoming?.clid) return incoming
  return null
}

/**
 * Payload **sintético** de forma CRM Kommo (`message[add]`) alineado con la
 * integración La Vilet / tests. No es una captura de webhook real de Kommo;
 * **no demuestra** qué campos entrega Kommo en producción.
 * Sirve solo para contrastar la forma esperada del normalizador.
 */
export const KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE = {
  _fixture_kind: 'synthetic_kommo_crm_shape',
  _fixture_note:
    'Sintético: no es evidencia de payload real de Kommo. Validar con captura anonimizada del webhook CRM cuando exista.',
  account: { id: 36919007, subdomain: 'example' },
  message: {
    add: [
      {
        id: 'anon-msg-001',
        element_id: 10001,
        entity_id: 10001,
        entity_type: 'lead',
        contact_id: 20002,
        chat_id: 'anon-chat',
        text: 'Hola, me interesa un depto',
        created_at: 1720000000,
        origin: 'waba',
        type: 'incoming',
        author: { type: 'external', name: 'Cliente' },
      },
    ],
  },
} as const

/** @deprecated Usar KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE */
export const KOMMO_CRM_INBOUND_REFERENCE_ANON = KOMMO_CRM_INBOUND_SYNTHETIC_FIXTURE

/**
 * Fixture **sintético** Meta Cloud API: dónde SÍ documenta Meta el ctwa_clid.
 * No es un webhook Kommo.
 */
export const META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE = {
  _fixture_kind: 'synthetic_meta_cloud_api_shape',
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                from: '593990000000',
                id: 'wamid.ANON',
                timestamp: '1720000000',
                type: 'text',
                text: { body: 'Hola' },
                referral: {
                  source_url: 'https://fb.me/anon',
                  source_id: '120000000000000000',
                  source_type: 'ad',
                  headline: 'Chat with us',
                  body: 'Ad body',
                  media_type: 'image',
                  ctwa_clid: 'Aff-ANON_CTWA_CLID_EXAMPLE_NOT_REAL',
                },
              },
            ],
          },
        },
      ],
    },
  ],
} as const

/** @deprecated Usar META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE */
export const META_CLOUD_CTWA_REFERRAL_REFERENCE_ANON = META_CLOUD_CTWA_REFERRAL_SYNTHETIC_FIXTURE

export const KOMMO_CTWA_LIMITATION =
  'Limitación: el fixture CRM es sintético y aún no demuestra qué entrega el webhook real de Kommo. La documentación pública de message[add] / Chats no declara referral.ctwa_clid; Meta Cloud API sí lo envía en el primer mensaje. Sin captura real anonimizada de Kommo, el CRM no debe inventar el dato ni atribuir ads/orgánico por omisión.'
