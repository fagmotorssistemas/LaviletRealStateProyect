export const TEST_RESPONSE_SETTING = 'automation_test_response_mode'
export const TEST_RESPONSE_PHONE = '0987110032'
export const TEST_RESPONSE_SECONDS = 0
export const NORMAL_RESPONSE_SECONDS = 30
/** Local Ecuadorian mobiles or an explicit international number. */
export function normalizeTestPhone(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[+\d\s().-]+$/.test(value.trim())) return null
  const digits = value.replace(/\D/g, '')
  if (/^09\d{8}$/.test(digits)) return `593${digits.slice(1)}`
  if (/^5939\d{8}$/.test(digits)) return digits
  if (value.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return digits
  return null
}
// Unpublished policy previews retain their separate authorization.
export function isTestPhone(value: unknown) { return normalizeTestPhone(value) === '593987110032' }
export type TestContact = {
  id: string; phone: string; label: string; fastResponse: boolean; version: number
  leadId: string | null; kommoId: number | null; botEnabled: boolean; matches: number
  blocked: boolean; lastResetAt: string | null
}
export type TestResponseState = { contacts: TestContact[] }

/** A CRM phone match does not imply that WhatsApp/Kommo has linked the lead. */
export function testContactControls(contact: TestContact) {
  const duplicate = contact.matches > 1
  const waiting = contact.matches === 0 || !contact.leadId
  const linked = !duplicate && !waiting && contact.matches === 1
    && Number.isSafeInteger(contact.kommoId) && Number(contact.kommoId) > 0
  const linkHelp = waiting
    ? 'Envíe un primer mensaje desde este número al WhatsApp del proyecto y pulse «Actualizar lista». Los botones de reinicio y reanudación estarán disponibles cuando se vincule el lead con Kommo.'
    : 'Este teléfono ya tiene un lead en el CRM, pero todavía no está vinculado con Kommo. Envíe un mensaje desde este número al WhatsApp del proyecto y pulse «Actualizar lista». Después podrá reiniciar la prueba o reanudar el bot.'
  const resetDisabledReason = duplicate ? 'Hay varios leads con este teléfono. Resuelva el duplicado antes de reiniciar o reanudar.'
    : !linked ? linkHelp : ''
  const resumeDisabledReason = resetDisabledReason || (contact.blocked
    ? 'Hay una derivación al equipo o una solicitud de no recibir mensajes. Resuelva ese estado antes de reanudar el bot.' : '')
  return {
    label: duplicate ? 'Varios leads con este número' : waiting ? 'Esperando primer mensaje'
      : !linked ? 'Pendiente de vincular WhatsApp' : contact.botEnabled ? 'Bot habilitado' : 'Bot pausado',
    explanation: resetDisabledReason || resumeDisabledReason || (!contact.botEnabled
      ? 'El bot está deshabilitado para este lead. «Reanudar bot» conserva la conversación; «Reiniciar prueba» permite empezar desde cero.' : ''),
    canReset: linked, canResume: linked && !contact.blocked,
    resetDisabledReason, resumeDisabledReason,
  }
}

export function testLeadAllowed(config: Record<string, unknown>, leadId: unknown, environmentLead: string | null = null) {
  if (environmentLead && environmentLead !== leadId) return false
  return config.test_only === false || (Array.isArray(config.test_lead_ids)
    ? config.test_lead_ids.includes(leadId) : config.test_lead_id === leadId)
}
