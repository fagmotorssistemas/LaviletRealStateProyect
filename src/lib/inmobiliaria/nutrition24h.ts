export const NUTRITION_24H_BODY = 'Hola, le saludamos de La Vilet. Estamos disponibles para {{1}}. ¿Le gustaría continuar la conversación?'
export type Nutrition24hConfig = {
  enabled: boolean; templateName: string; metaApproved: boolean; templateLinked: boolean
  botId: number; fieldId: number; activatedAt: string | null
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function nutrition24hConfig(policies: unknown): Nutrition24hConfig {
  const r = record(record(policies).nutrition_24h)
  return { enabled: r.enabled === true, metaApproved: r.metaApproved === true, templateLinked: r.templateLinked === true,
    templateName: typeof r.templateName === 'string' ? r.templateName : 'NUTRICION_MENSAJE_24H',
    botId: Number.isSafeInteger(r.botId) ? Number(r.botId) : 20968,
    fieldId: Number.isSafeInteger(r.fieldId) ? Number(r.fieldId) : 530422,
    activatedAt: typeof r.activatedAt === 'string' ? r.activatedAt : null }
}
export function nutrition24hReady(config: Nutrition24hConfig) {
  return config.enabled && config.metaApproved && config.templateLinked && config.botId > 0 && config.fieldId > 0
    && !!config.templateName.trim() && Number.isFinite(Date.parse(config.activatedAt || ''))
}
export function withNutrition24h(policies: unknown, input: Nutrition24hConfig, now = new Date().toISOString()) {
  if (typeof input.enabled !== 'boolean' || typeof input.metaApproved !== 'boolean' || typeof input.templateLinked !== 'boolean'
    || typeof input.templateName !== 'string' || !input.templateName.trim() || input.templateName.length > 150
    || !Number.isSafeInteger(input.botId) || input.botId <= 0 || !Number.isSafeInteger(input.fieldId) || input.fieldId <= 0) throw Error('Revise los datos de la plantilla y del Salesbot.')
  const previous = nutrition24hConfig(policies)
  const config = { enabled: input.enabled, metaApproved: input.metaApproved, templateLinked: input.templateLinked,
    templateName: input.templateName.trim(), botId: input.botId, fieldId: input.fieldId,
    activatedAt: input.enabled ? previous.enabled ? previous.activatedAt : now : null }
  if (config.enabled && !nutrition24hReady(config)) throw Error('Antes de activar, confirme que Meta aprobó la plantilla y que está vinculada al Salesbot con el texto y la variable indicados.')
  return { ...record(policies), nutrition_24h: config }
}

// Ecuador continental is UTC-5. Sending is further limited by the project's hours.
// We never move a due time backwards or send outside 09:00–18:00.
export function nutritionSendTime(due: number, businessHours: unknown): number | null {
  if (!Number.isFinite(due)) return null
  const hours = record(businessHours), offset = 5 * 3_600_000
  const local = new Date(due - offset)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())
  const minutes = (v: unknown) => {
    if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) return NaN
    const [h, m] = v.split(':').map(Number); return h * 60 + m
  }
  for (let day = 0; day < 8; day++) {
    const start = midnight + day * 86_400_000, weekday = new Date(start).getUTCDay()
    if (!weekday) continue
    const row = record(hours[String(weekday)])
    const open = Math.max(9 * 60, minutes(row.open)), close = Math.min(18 * 60, minutes(row.close))
    if (!Number.isFinite(open) || !Number.isFinite(close) || close <= open) continue
    const candidate = Math.max(due, start + offset + open * 60_000)
    if (candidate < start + offset + close * 60_000) return candidate
  }
  return null
}
