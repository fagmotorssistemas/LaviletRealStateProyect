export const WEEK_ONE_BROCHURE_URL = 'https://www.lavilett.com/brochure'
export const WEEK_ONE_BROCHURE_BODY = `Hola, le saluda el equipo de La Vilet. Sabemos que elegir dónde vivir o invertir merece tiempo y atención.

Le compartimos nuestro brochure para que conozca las suites, departamentos y locales comerciales del proyecto:

${WEEK_ONE_BROCHURE_URL}

Revíselo con calma. Si alguna opción le interesa, con gusto le ayudaremos a conocer sus detalles y resolver sus dudas.`
export const WEEK_ONE_FOLLOWUP_BODY = 'Hola, le saluda el equipo de La Vilet. Podemos ayudarle a {{1}}. Queremos que tenga la información que necesita para valorar su compra con calma. Si desea continuar, responda a este mensaje y con gusto le orientamos.'
export const WEEK_ONE_ROUTES = {
  brochure: { templateId: 13542, templateName: 'MENSAJE NUTRICION 1S', botId: 21392 },
  followup: { templateId: 13554, templateName: 'MENSAJE NUTRICION 1S SEGUIMIENTO', botId: 21394, fieldId: 530950 },
} as const
export type NutritionWeekOneConfig = {
  enabled: boolean; activatedAt: string | null; brochureEnabled: boolean
  alreadyShared: 'relevant' | 'skip'; unitDetails: boolean; comparison: boolean; financing: boolean; visits: boolean
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function nutritionWeekOneConfig(policies: unknown): NutritionWeekOneConfig {
  const p = record(record(policies).nutrition_week_one)
  return { enabled: p.enabled === true, activatedAt: typeof p.activatedAt === 'string' ? p.activatedAt : null,
    brochureEnabled: p.brochureEnabled !== false, alreadyShared: p.alreadyShared === 'skip' ? 'skip' : 'relevant',
    unitDetails: p.unitDetails !== false, comparison: p.comparison !== false, financing: p.financing !== false, visits: p.visits === true }
}
export function nutritionWeekOneReady(c: NutritionWeekOneConfig) {
  return c.enabled && !!c.activatedAt && Number.isFinite(Date.parse(c.activatedAt))
}
export function withNutritionWeekOne(policies: unknown, input: NutritionWeekOneConfig, now = new Date().toISOString()) {
  if (['enabled', 'brochureEnabled', 'unitDetails', 'comparison', 'financing', 'visits'].some(k => typeof input[k as keyof NutritionWeekOneConfig] !== 'boolean')
    || !['relevant', 'skip'].includes(input.alreadyShared)) throw Error('Revise las opciones de seguimiento de la semana 1.')
  const previous = nutritionWeekOneConfig(policies)
  const config = { enabled: input.enabled, brochureEnabled: input.brochureEnabled, alreadyShared: input.alreadyShared,
    unitDetails: input.unitDetails, comparison: input.comparison, financing: input.financing, visits: input.visits,
    activatedAt: input.enabled ? previous.enabled ? previous.activatedAt : now : null }
  if (input.enabled && !nutritionWeekOneReady(config)) throw Error('La fecha de activación no es válida.')
  return { ...record(policies), nutrition_week_one: config }
}
