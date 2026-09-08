export const GUION_START = '# GUION CRM START'
export const GUION_END = '# GUION CRM END'

const ENGINEER_PROMPT_NAMES = new Set([
  'respuesta_comercial',
  'clasificador_intenciones',
  'extractor_eventos',
  'resumen_conversacion',
  'guion_preguntas',
])

export function isEngineerPrompt(name: string) {
  return ENGINEER_PROMPT_NAMES.has(name)
}

export function buildGuionBlock(questions: { question_text: string }[]) {
  const items = questions
    .map((row) => row.question_text.trim())
    .filter(Boolean)
  const lines = items.length
    ? items.map((text, index) => `${index + 1}. ${text}`)
    : ['No hay preguntas de captura activas. No indagues datos adicionales por tu cuenta.']

  return [
    GUION_START,
    'Si falta alguno de estos datos, pregunta UNA sola por mensaje, en este orden.',
    'No insistas si el cliente ya respondió. En lanzamiento no preguntes precio, cuotas ni disponibilidad.',
    ...lines,
    GUION_END,
  ].join('\n')
}

export function replaceGuionBlock(content: string, block: string) {
  const start = content.indexOf(GUION_START)
  const end = content.indexOf(GUION_END)
  if (start >= 0 && end >= start) {
    const after = end + GUION_END.length
    return `${content.slice(0, start).replace(/\s+$/, '')}\n\n${block}${content.slice(after).replace(/^\s*/, '\n')}`
  }
  return `${content.replace(/\s+$/, '')}\n\n${block}\n`
}
