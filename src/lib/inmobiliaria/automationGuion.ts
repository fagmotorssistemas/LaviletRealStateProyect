export const GUION_START = '# GUION CRM START'
export const GUION_END = '# GUION CRM END'

const ENGINEER_PROMPT_NAMES = new Set([
  'respuesta_comercial',
  'clasificador_intenciones',
  'extractor_eventos',
  'resumen_conversacion',
  'guion_preguntas',
  'saludo_inicial',
  'revisor_respuesta',
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
    : ['No hay preguntas adicionales. Sigue el descubrimiento comercial del prompt principal.']

  return [
    GUION_START,
    'Estas preguntas son una guía adicional. Contesta primero la consulta y adapta una sola pregunta al interés actual.',
    'Omite datos conocidos, preguntas ajenas al tipo de inmueble y preguntas que el cliente no desee responder. No es necesario completar el guion para coordinar una visita.',
    'Puedes preguntar el presupuesto del comprador; los precios y las condiciones del proyecto dependen del modo comercial y los datos autorizados.',
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
