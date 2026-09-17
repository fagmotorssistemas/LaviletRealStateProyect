import { object, text, type Row } from './data'

const normalized = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
/** Only unambiguous answers to the last delivered question bypass sector classification. */
export function financingFieldAnswer(current: string, history: unknown, qualification: Row): Row | null {
  if (qualification.explicit_consent !== true || ['lista','rechazada','cancelada','cerrada'].includes(text(qualification.status))) return null
  const messages = (Array.isArray(history) ? history : []).map(object)
  const previous = messages.filter(m => ['bot','asesor'].includes(text(m.role))).at(-1)
  if (previous?.role !== 'bot') return null
  const question = normalized(text(previous.content).match(/¿[^?]+\?\s*$/)?.[0] || '')
  const value = current.replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu,'').trim()
  const m = normalized(value)
  if (!question || !value || value.length > 100 || /[?¿!\n]|https?:|@/.test(value)
    || /\b(?:no|quiero|quisiera|necesito|busco|buscando|tienen|ofrecen|contratan|vacante|vacantes|pedido|envie|mandeme|cancelar|asesor|olvida|ignora|instrucciones|gustaria|visita|cita|precio|cuesta|hola|gracias)\b/.test(m)) return null
  if (/cargo|ocupacion|profesion/.test(question) && qualification.job_title == null
    && /^(?:soy |trabajo como )?[\p{L}][\p{L} .'-]{1,70}$/u.test(value) && value.split(/\s+/).length <= 7)
    return {job_title:value.replace(/^(?:soy|trabajo como)\s+/i,'')}
  if (/cuanto tiempo|antiguedad/.test(question) && qualification.employment_stability_months == null) {
    const duration=m.match(/^(\d{1,2})\s*(anos?|mes(?:es)?)$/)
    if(duration) return {employment_stability_months:Number(duration[1])*(duration[2].startsWith('ano')?12:1)}
  }
  if (/dependencia|independiente/.test(question) && qualification.applicant_type == null) {
    if (/^(?:dependencia|dependiente|empleado|empleada|relacion de dependencia)$/.test(m)) return {applicant_type:'empleado'}
    if (m==='independiente') return {applicant_type:'independiente'}
  }
  if (/ingreso.*mensual/.test(question) && qualification.monthly_income == null && /^\$?\s*\d{1,7}(?:[.,]\d{1,2})?(?:\s*(?:usd|dolares))?$/.test(m))
    return {monthly_income:Number(m.replace(/[^\d.,]/g,'').replace(',','.'))}
  return null
}

export const FINANCING_COLLECTION_RULE = '\nEn recopilación de datos financieros, pida directamente el siguiente dato pendiente. No repita el dato recibido, la entidad ni la finalidad de cada pregunta. No agregue «esto permitirá», «este dato es necesario» ni supuestos requisitos internos de la entidad. Explique el propósito al iniciar, si es necesario para entender la solicitud o si el cliente pregunta. Incluso en modo explicativo, una respuesta simple a un campo no necesita una explicación adicional.\n'
export function financingCollectionIssues(reply: string, context: Row, current = ''): boolean {
  if(/[¿?]|\b(?:por que|para que)\b/.test(normalized(current))) return false
  if(context.source !== 'financing' || !/^(?:identificacion|nombre|cedula|tipo_solicitante|estabilidad|cargo|ingreso|ruc)_pendiente$/.test(text(context.state))) return false
  const m=normalized(reply)
  return /esto (?:nos )?permit|este dato|requisitos internos|conforme a|gracias por indic|confirmo que he recibido|permanezco atento|una vez que lo comparta/.test(m)
    || reply.split(/\s+/).length > 35
}
