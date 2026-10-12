import { normalized } from './sdr-rules'
import { LATER_ROUTES } from '@/lib/inmobiliaria/nutritionLater'
import { replyQuestions } from './reply-question'

/** A short acceptance has no separate information request. The caller still
 * needs an actual process invitation; these words alone authorize nothing. */
export function simpleFinancingAcceptance(current: string): boolean {
  const message = normalized(current)
  if (/[¿?]/.test(current) || /\b(?:pero|solo|siempre que|a condicion|antes de|si me (?:aprueban|aseguran|garantizan))\b/.test(message)) return false
  if (/^(si|si claro|claro|si por favor|si esta bien|si me parece bien|esta bien|bueno esta bien|adelante|de acuerdo|continuemos|si continuemos|por supuesto|si por supuesto|hagamoslo|me gustaria)$/.test(message)) return true
  return /^(?:(?:si|claro|bueno|de acuerdo|adelante|por supuesto) )?(?:continuemos|sigamos|avancemos)(?: (?:por favor|con (?:el |la |banco |cooperativa )?[a-z .'-]+))?$/.test(message)
    && !/\b(?:cuanto|cual|como|que|entrada|cuotas?|tasa|porcentaje|plazo|mensualidad|requisitos|saber|explicar|informacion)\b/.test(message)
}

/** The delivered invitation's act determines consent eligibility. Review labels
 * and a remembered topic cannot turn information or a property choice into it. */
export function operationalFinancingInvitation(reply: string): boolean {
  if (([2, 3] as const).some(week => {
    const [before, after] = LATER_ROUTES[week].body.split('{{1}}')
    return reply.trim().startsWith(before) && reply.trim().endsWith(after)
  })) return false
  const previous = normalized(reply)
  const question = normalized(replyQuestions(reply).at(-1) || '')
  const financialContext = /financ|credito|revision|revisar esa opcion|banco|cooperativa|pichincha|\bjep\b/.test(previous)
  const operationalInvitation = /\b(?:iniciar|iniciemos|iniciamos|empezar|empecemos|empezamos|continuar|continuemos|continuamos|avanzar|avancemos|avanzamos|revisar|revisemos|revisamos|evaluar|evaluemos|evaluamos|realizar|hacer|precalificar|recopilar|recopilemos|recopilamos|recoger|recojamos)\b/.test(question)
    && /\b(?:le gustaria|desea|quiere|podemos|iniciemos|iniciamos|empecemos|empezamos|continuemos|continuamos|avancemos|avanzamos|revisemos|revisamos|evaluemos|evaluamos|recopilemos|recopilamos|recojamos)\b/.test(question)
  const explicitProcess = /\b(?:iniciar|iniciemos|iniciamos|empezar|empecemos|empezamos|continuar|continuemos|continuamos|avanzar|avancemos|avanzamos)\b[^.!?]*\b(?:revision|evaluacion|solicitud|tramite|precalificacion|proceso)\b/.test(question)
  const informationalInvitation = /\b(?:expli[qc]\w*|inform\w*|orient\w*|conocer|saber|entender)\b/.test(question)
    || /\b(?:detalles|opciones|alternativas|requisitos|tasas|cuotas)\b/.test(question) && !explicitProcess
  const otherOperation = /visita|cita|reserva|(?:esta|esa|la|el) (?:unidad|opcion|penthouse|departamento|suite|local)\b/.test(question)
    && !/financ|credito|revision financiera|evaluacion financiera|precalific/.test(question)
  const humanAssistance = /\b(?:asesor|contact\w*|atencion humana)\b/.test(question)
  const lenderChoice = /^(?:con|por|mediante) (?:que|cual|cuales)\b/.test(question)
    || /^(?:que|cual|cuales)\b[^.!?]{0,45}\b(?:entidad|entidades|banco|bancos|cooperativa|cooperativas)\b/.test(question)
    || /\b(?:prefiere|prefiere que|elige|elija|escoja)\b/.test(question) && /banco|cooperativa|pichincha|\bjep\b/.test(question)
  const explicitSubject = /financ|credito|revision|evaluacion|precalific|banco|cooperativa|pichincha|\bjep\b/.test(question)
  return !!question && financialContext && operationalInvitation && (explicitSubject || explicitProcess)
    && !informationalInvitation && !otherOperation && !humanAssistance && !lenderChoice
}
