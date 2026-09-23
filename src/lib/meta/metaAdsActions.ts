/**
 * Resultados Meta Insights: elige UN action_type preferente.
 * No suma actions distintos/superpuestos (evita cifras infladas tipo “682”).
 */

export type MetaActionRow = {
  actionType: string
  value: number
}

export type MetaPrimaryResult = {
  actionType: string
  label: string
  value: number
  /** Otros action_types presentes (solo diagnóstico; no sumados). */
  otherActionTypes: string[]
}

/** Preferencia CTWA / mensajería / lead. Orden = prioridad. */
export const META_RESULT_ACTION_PRIORITY: string[] = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'onsite_conversion.messaging_first_reply',
  'onsite_conversion.messaging_conversation_started_7d_website',
  'lead',
  'onsite_conversion.lead_grouped',
  'offline_conversion.lead',
  'complete_registration',
  'omni_complete_registration',
  'link_click',
  'landing_page_view',
]

const ACTION_LABELS: Record<string, string> = {
  'onsite_conversion.messaging_conversation_started_7d':
    'Conversaciones iniciadas (atribución de 7 días)',
  'onsite_conversion.total_messaging_connection': 'Conexiones por mensajes',
  'onsite_conversion.messaging_first_reply': 'Primeras respuestas por mensajes',
  'onsite_conversion.messaging_conversation_started_7d_website':
    'Conversaciones desde la web (atribución de 7 días)',
  lead: 'Contactos informados por Meta',
  'onsite_conversion.lead_grouped': 'Contactos agrupados por Meta',
  'offline_conversion.lead': 'Contactos fuera de internet informados por Meta',
  complete_registration: 'Registros completados',
  omni_complete_registration: 'Registros en los distintos canales',
  link_click: 'Clics en enlace',
  landing_page_view: 'Visitas a la página del anuncio',
}

export function labelMetaActionType(actionType: string): string {
  return ACTION_LABELS[actionType] || 'Otra acción informada por Meta'
}

export function parseMetaActions(raw: unknown): MetaActionRow[] {
  if (!Array.isArray(raw)) return []
  const out: MetaActionRow[] = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const rec = a as Record<string, unknown>
    const actionType =
      typeof rec.action_type === 'string' ? rec.action_type.trim() : ''
    const value = Number(rec.value)
    if (!actionType || !Number.isFinite(value)) continue
    out.push({ actionType, value })
  }
  return out
}

/**
 * Selecciona el resultado primario por prioridad.
 * Si no hay preferido conocido, toma el de mayor valor pero NO suma todos.
 */
export function selectPrimaryMetaResult(
  rawActions: unknown,
): MetaPrimaryResult | null {
  const rows = parseMetaActions(rawActions)
  if (!rows.length) return null
  const byType = new Map<string, number>()
  for (const r of rows) {
    byType.set(r.actionType, (byType.get(r.actionType) || 0) + r.value)
  }
  for (const preferred of META_RESULT_ACTION_PRIORITY) {
    const v = byType.get(preferred)
    if (v != null) {
      const others = [...byType.keys()].filter((k) => k !== preferred)
      return {
        actionType: preferred,
        label: labelMetaActionType(preferred),
        value: v,
        otherActionTypes: others,
      }
    }
  }
  // Fallback: mayor valor individual (sin sumar tipos distintos)
  let bestType = ''
  let bestVal = -Infinity
  for (const [t, v] of byType) {
    if (v > bestVal) {
      bestVal = v
      bestType = t
    }
  }
  if (!bestType) return null
  return {
    actionType: bestType,
    label: labelMetaActionType(bestType),
    value: bestVal,
    otherActionTypes: [...byType.keys()].filter((k) => k !== bestType),
  }
}
