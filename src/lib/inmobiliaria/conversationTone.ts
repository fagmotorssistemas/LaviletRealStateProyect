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
  const style = { actual: 'Conserve el estilo habitual del proyecto.', cercano: 'Use lenguaje cotidiano, sencillo y conversacional, siempre de usted. Conecte la respuesta con la necesidad expresada sin repetirla literalmente ni asumir familiaridad.', equilibrado: 'Use lenguaje profesional, claro y directo, siempre de usted. Responda primero; evite introducciones ceremoniosas y explicar su propia intención de ayudar.', elegante: 'Use una redacción elegante y sobria, siempre de usted: frases fluidas, completas y precisas, sin muletillas, coloquialismos ni palabras rebuscadas. La elegancia no exige mayor extensión. Converse con el cliente, no redacte un informe sobre él: evite «Ha manifestado interés», «Para facilitarle el proceso» y cierres ceremoniosos sin información.' }[v.style]
  const warmth = ['Use cortesía discreta y respetuosa. Vaya directamente a la respuesta, sin «con gusto», agradecimientos ni ofrecimientos de acompañamiento rutinarios. Salude cuando corresponda y reconozca una dificultad real con tacto.', 'Mantenga una calidez moderada: una cortesía breve es opcional cuando encaje, sin repetir fórmulas ni entusiasmo artificial.', 'Exprese mayor calidez mediante atención a la necesidad o inquietud que el cliente manifestó: reconózcala brevemente y acompañe la explicación. No invente emociones, elogios ni agradecimientos automáticos.'][v.warmth]
  const detail = ['Prefiera respuestas concisas: para una consulta simple, una o dos frases. No repita la preferencia recibida, la fecha ni el siguiente paso. Omita introducciones, beneficios adicionales y explicaciones de por qué hace una pregunta. Si hay varias consultas, conteste todas de forma breve sin perder datos necesarios.', 'Responda directamente y agregue solo un contexto breve que ayude a entender la respuesta.', 'Sea explicativo: desarrolle diferencias, opciones o pasos relevantes respaldados por el contexto, con párrafos breves cuando ayuden. No alargue saludos, cortesías ni respuestas simples; no repita beneficios ni información ya resuelta.'][v.detail]
  return `\nESTILO SELECCIONADO POR EL RESPONSABLE DEL PROYECTO:\n${style}\n${warmth}\n${detail}\nEstas preferencias prevalecen únicamente sobre las indicaciones anteriores de estilo, calidez y extensión. No cambian hechos, cifras, enlaces, consentimiento, identidad, límites de longitud del canal, estado de trámites ni cobertura de preguntas. No agregue preguntas, beneficios, promesas o acciones por cambiar el tono. Los criterios de revisión deben aceptar este estilo.\n`
}
export type ToneState = { current: ToneSettings; previous: ToneSettings | null; version: number; updatedAt: string | null }
