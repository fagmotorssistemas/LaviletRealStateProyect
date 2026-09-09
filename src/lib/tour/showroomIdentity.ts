/**
 * Identidad liviana del showroom (celular = “sesión” de cara al visitante).
 * La cookie real de servidor sigue siendo `lv_vid`; el teléfono se guarda en el lead.
 */
const PHONE_KEY = 'lv_showroom_phone'
const LEAD_KEY = 'lv_showroom_lead'

export function normalizeShowroomPhone(raw: string) {
  return String(raw ?? '').replace(/[^\d+]/g, '').trim()
}

export function getShowroomPhone() {
  if (typeof window === 'undefined') return ''
  try {
    return normalizeShowroomPhone(window.localStorage.getItem(PHONE_KEY) ?? '')
  } catch {
    return ''
  }
}

export function getShowroomLeadId() {
  if (typeof window === 'undefined') return ''
  try {
    return String(window.localStorage.getItem(LEAD_KEY) ?? '').trim()
  } catch {
    return ''
  }
}

export function isShowroomIdentified() {
  return Boolean(getShowroomPhone())
}

export function setShowroomIdentity(phone: string, leadId?: string | null) {
  if (typeof window === 'undefined') return
  const normalized = normalizeShowroomPhone(phone)
  try {
    if (normalized) window.localStorage.setItem(PHONE_KEY, normalized)
    if (leadId) window.localStorage.setItem(LEAD_KEY, leadId)
  } catch {
    /* ignore */
  }
}

export function clearShowroomIdentity() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(PHONE_KEY)
    window.localStorage.removeItem(LEAD_KEY)
  } catch {
    /* ignore */
  }
}

/** Email sintético estable por teléfono (el RPC exige email; el match real es por phone). */
export function syntheticEmailFromPhone(phone: string) {
  const digits = normalizeShowroomPhone(phone).replace(/\D/g, '')
  return `wa.${digits || 'anon'}@showroom.lavilet`
}

export function syntheticNameFromPhone(phone: string) {
  const digits = normalizeShowroomPhone(phone).replace(/\D/g, '')
  const tail = digits.slice(-4) || '····'
  return `WhatsApp ····${tail}`
}
