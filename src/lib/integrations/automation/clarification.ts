import { normalized } from './sdr-rules'

export function mediaClarificationReply(current: string) {
  const m = normalized(current)
  if (/interpret|leer|archivo|imagen|foto|plano/.test(m) && /no pued|no pudieron|no se (?:ve|lee)|no entend|no leyeron/.test(m)) {
    return 'Disculpe la confusión con el archivo. Puedo revisar imágenes y PDF, pero esa lectura no salió bien. ¿Puede reenviarlo más nítido o escribir el número que aparece en el título?'
  }
  if (/(?:pueden|puedes|puede).*?(?:leer|interpretar|revisar).*?(?:archivos|imagenes|pdf|planos)/.test(m)) {
    return 'Sí, puedo revisar imágenes y PDF. Si es un plano, procure que se vea el título con el número de la unidad para identificarla correctamente.'
  }
  return ''
}

export function fabricatedActionRequest(current: string) {
  const m = normalized(current)
  return /aunque no|sin (?:registrar|revisar|verificar)|inventa|finge/.test(m) && /confirmad|confirmar|agendad|reservad|credito aprobado/.test(m)
}
