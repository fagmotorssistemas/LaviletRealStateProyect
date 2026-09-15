export type LaterWeek = 2 | 3
export const NUTRITION_TASKS = ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three']
export const LATER_ROUTES = {
  2: { task: 'nutrition_week_two', templateId: 13616, botId: 21446, fieldId: 530952, name: 'MENSAJE NUTRICION 2S',
    attachmentId: 'ee0ef35c-6df1-4401-baf4-8176c0203dca',
    body: 'Sabemos que elegir {{1}} merece tiempo y atención. Por eso, el equipo de La Vilet está disponible para resolver sus dudas y ayudarle a comparar sus opciones con calma. ¿Hay algún detalle que le gustaría revisar antes de dar el siguiente paso?' },
  3: { task: 'nutrition_week_three', templateId: 13618, botId: 21452, fieldId: 530954, name: 'MENSAJE NUTRICION 3S', attachmentId: null,
    body: '¡Saludos!, esperamos que se encuentre muy bien.\nSi desea avanzar con una opción de La Vilet, podemos ayudarle a {{1}}. Nuestro equipo le explicará los pasos y lo que necesita para continuar. ¿Le gustaría que lo revisemos juntos?' },
} as const
export type LaterConfig = { enabled: boolean; activatedAt: string | null }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function nutritionLaterConfig(policies: unknown): Record<LaterWeek, LaterConfig> {
  const p = record(record(policies).nutrition_later)
  const read = (week: LaterWeek): LaterConfig => {
    const r = record(p[String(week)])
    return { enabled: r.enabled === true, activatedAt: typeof r.activatedAt === 'string' ? r.activatedAt : null }
  }
  return { 2: read(2), 3: read(3) }
}
export function withNutritionLater(policies: unknown, input: Record<LaterWeek, boolean>, now = new Date().toISOString()) {
  const previous = nutritionLaterConfig(policies)
  const next = (week: LaterWeek) => {
    if (typeof input[week] !== 'boolean') throw Error('Revise la activación de cada semana.')
    const activatedAt = input[week] ? previous[week].enabled ? previous[week].activatedAt : now : null
    if (input[week] && !Number.isFinite(Date.parse(activatedAt || ''))) throw Error('Fecha de activación inválida.')
    return { enabled: input[week], activatedAt }
  }
  return { ...record(policies), nutrition_later: { 2: next(2), 3: next(3) } }
}
