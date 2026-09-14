export type BotVisitPolicy = { allowSuggestions: boolean; launchDestination: 'site' | 'office' }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function botVisitPolicy(policies: unknown, mode: string): BotVisitPolicy {
  const p = record(record(policies).bot_visits)
  return { allowSuggestions: typeof p.allow_suggestions === 'boolean' ? p.allow_suggestions : mode !== 'lanzamiento',
    launchDestination: p.launch_destination === 'office' ? 'office' : 'site' }
}
export function withBotVisitPolicy(policies: unknown, policy: BotVisitPolicy) {
  if (typeof policy.allowSuggestions !== 'boolean' || !['site', 'office'].includes(policy.launchDestination)) throw Error('Revise la configuración de visitas.')
  return { ...record(policies), bot_visits: { ...record(record(policies).bot_visits), allow_suggestions: policy.allowSuggestions, launch_destination: policy.launchDestination } }
}
export function visitInvitation(mode: string, policy: BotVisitPolicy) {
  if (!policy.allowSuggestions) return ''
  if (mode !== 'lanzamiento') return '¿Le gustaría coordinar una visita para conocer el proyecto en persona?'
  return policy.launchDestination === 'office'
    ? '¿Le gustaría coordinar una visita a nuestra oficina para revisar el proyecto?'
    : '¿Le gustaría coordinar una visita para conocer el lugar donde se construirá La Vilet?'
}
