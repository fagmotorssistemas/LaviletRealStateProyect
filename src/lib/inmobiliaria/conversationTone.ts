export const TONE_SETTING_NAME = 'conversation_tone_settings'
export const TONE_STYLES = ['actual', 'cercano', 'equilibrado', 'elegante'] as const
export type ToneSettings = { style: typeof TONE_STYLES[number]; warmth: number; detail: number }
export const DEFAULT_TONE: ToneSettings = { style: 'actual', warmth: 1, detail: 1 }
export const TONE_LABELS = { actual: 'Estilo actual', cercano: 'Cercano', equilibrado: 'Equilibrado', elegante: 'Elegante' }
export function validateTone(value: unknown): ToneSettings {
  if (!value || typeof value !== 'object') throw new Error('Configuración de tono inválida')
  const v = value as ToneSettings
  if (!TONE_STYLES.includes(v.style) || ![0, 1, 2].includes(v.warmth) || ![0, 1, 2].includes(v.detail)) throw new Error('Configuración de tono inválida')
  return { style: v.style, warmth: v.warmth, detail: v.detail }
}
export function toneIsDefault(value: ToneSettings) { return value.style === 'actual' && value.warmth === 1 && value.detail === 1 }
export function toneDirection(value: ToneSettings): string {
  const v = validateTone(value)
  if (toneIsDefault(v)) return ''
  const style = { actual: 'Conserve el estilo habitual del proyecto.', cercano: 'Use una redacción cercana, sencilla y conversacional, siempre de usted.', equilibrado: 'Use una redacción profesional, natural y directa, siempre de usted.', elegante: 'Use una redacción elegante y sobria, siempre de usted; evite palabras rebuscadas, solemnidad y lenguaje publicitario excesivo.' }[v.style]
  const warmth = ['Use cortesía discreta; vaya al punto sin sonar seco.', 'Mantenga una calidez moderada, sin entusiasmo artificial.', 'Exprese mayor calidez y disposición a ayudar, sin elogios automáticos ni familiaridad excesiva.'][v.warmth]
  const detail = ['Prefiera respuestas concisas; conserve todas las respuestas y datos necesarios.', 'Mantenga el nivel de detalle habitual, adaptado a la consulta.', 'Explique con algo más de detalle cuando sea útil, sin repetir beneficios ni agregar información no solicitada.'][v.detail]
  return `\nESTILO SELECCIONADO POR EL RESPONSABLE DEL PROYECTO:\n${style}\n${warmth}\n${detail}\nEstas preferencias prevalecen únicamente sobre las indicaciones anteriores de estilo, calidez y extensión. No cambian hechos, cifras, enlaces, consentimiento, identidad, límites de longitud del canal, estado de trámites ni cobertura de preguntas. No agregue preguntas, beneficios, promesas o acciones por cambiar el tono. Los criterios de revisión deben aceptar este estilo.\n`
}
export type ToneState = { current: ToneSettings; previous: ToneSettings | null; version: number; updatedAt: string | null }
