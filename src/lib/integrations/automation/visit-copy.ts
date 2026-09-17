import { object, text, type Row } from './data'

export const VISIT_COPY_RULES = '\nEn coordinación de visitas, distinga preferencia recibida de cita confirmada: si aún se revisa disponibilidad, diga que recibió la preferencia, no «gracias por confirmar» ni «su confirmación». Conserve el lugar de atención: una cita en oficina no se convierte en visita al proyecto. Indique fecha y hora una sola vez, completas, sin repetir el mismo siguiente paso.\n'
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
export function isVisitCopy(context: Row) {
  return [context.source, context.action].some(value => typeof value === 'string' && value.startsWith('visit_'))
}
export function visitCopyIssues(base: string, draft: string): string[] {
  const source = normalize(base), value = normalize(draft), issues: string[] = []
  const pending = /disponibilidad|pendiente|por confirmar|verificaremos|revisaremos|equipo confirme|equipo revise/.test(source)
  if (pending && /gracias por confirmar|su confirmacion|(?:su|la) (?:cita|visita) (?:esta|queda|quedo) confirmada/.test(value)) issues.push('ambiguous_visit_confirmation')
  if (/\boficina\b/.test(source) && (!/\boficina\b/.test(value) || /visitar el proyecto|visita al proyecto/.test(value))) issues.push('visit_location_changed')
  if (/\b\d{1,2}(?::\d{2})?\s*[ap]\.(?!\s*m\.)/i.test(draft)) issues.push('truncated_visit_time')
  if (/es una opcion (?:dentro )?de (?:nuestro|el) horario|dentro de nuestro horario de atencion/.test(value)) issues.push('administrative_visit_copy')
  if (/en el transcurso de hoy|antes del sabado|pronto recibira|hoy.*(?:confirm|respuesta)/.test(value) && !/en el transcurso de hoy|antes del sabado|pronto recibira|hoy.*(?:confirm|respuesta)/.test(source)) issues.push('unverified_confirmation_deadline')
  return issues
}

/** Final guard covers commercial paths as well as the dedicated visit flow. */
export function visitTruthReply(reply: string, info: Row, audit: Row, proposals: Row[], sentences: (value: string) => string[]): string {
  const launch = info.modo_comercial === 'lanzamiento'
  const office = object(info.politica_visitas).launchDestination === 'office'
  const registered = audit.registration_verified === true || proposals.some(p => ['awaiting_advisor', 'awaiting_client', 'confirmed'].includes(text(p.status)))
  let destinationRemoved = false, claimRemoved = false, deadlineRemoved = false
  const kept = sentences(reply).filter(sentence => {
    const v = normalize(sentence)
    if (launch && /(?:conozca|conocer|recorrer|visitar|ver) (?:personalmente )?(?:los |las |un |una |el )?(?:departamentos?|vistas|pisos altos)|visita.*(?:departamentos|vistas).*personalmente/.test(v)) { destinationRemoved = true; return false }
    if (!registered && /(?:solicitud|visita|cita).*(?:ha quedado|quedo|esta|hemos) registrad|(?:hemos|he) registrado.*(?:solicitud|visita|cita)/.test(v)) { claimRemoved = true; return false }
    if (/en el transcurso de hoy|pronto recibira.*confirmacion|(?:confirm|comunicaremos|respuesta).*antes del (?:sabado|lunes|martes|miercoles|jueves|viernes|domingo)/.test(v)) { deadlineRemoved = true; return false }
    return true
  })
  if (destinationRemoved) kept.unshift(office ? 'Podemos recibirle en nuestra oficina para revisar los planos y el material del proyecto; todavía no hay departamentos terminados para recorrer.' : 'Podemos coordinar una visita al terreno donde se construirá el proyecto; todavía no hay departamentos terminados para recorrer.')
  if (claimRemoved) kept.push('Todavía no puedo confirmar que su solicitud de visita haya quedado registrada.')
  if (deadlineRemoved) kept.push('Aún no tengo una hora de confirmación; le avisaremos cuando el equipo verifique la disponibilidad.')
  return destinationRemoved || claimRemoved || deadlineRemoved ? kept.join(' ') : reply
}

export const VISIT_NATURAL_RULES = '\nAl recibir un horario, responda de forma directa: «Revisaremos la disponibilidad para recibirle…». No describa la validación interna con frases como «es una opción dentro de nuestro horario de atención». Mencione el horario de atención solo si lo preguntan o si la preferencia queda fuera. No prometa confirmación hoy, pronto o antes de una fecha sin un plazo verificado. Solo afirme que la solicitud está registrada si el resultado operativo lo respalda.\n'
