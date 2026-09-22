import { object, text, type Row } from './data'
import { readinessInvitation, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'

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
  const readiness=info.estado_proyecto as ProjectReadiness|undefined
  const launch = readiness ? !readiness.enabledPlaces.includes('completed_unit') : info.modo_comercial === 'lanzamiento'
  const office = object(info.politica_visitas).launchDestination === 'office'
  const registered = audit.registration_verified === true || proposals.some(p => ['awaiting_advisor', 'awaiting_client', 'confirmed'].includes(text(p.status)))
  const visitContext = isVisitCopy(audit) || /\bvisita|\bcita|horario/.test(normalize(reply))
  let destinationRemoved = false, claimRemoved = false, deadlineRemoved = false
  const kept = sentences(reply).filter(sentence => {
    const v = normalize(sentence)
    if(readiness && /visita|visitar|recorrer|recibirle|acercarse|conocer personalmente/.test(v) && !/no (?:podemos|es posible|hay)|no esta habilitad/.test(v)) {
      const forbidden = (!readiness.enabledPlaces.includes('office') && /oficina/.test(v))
        || (!readiness.enabledPlaces.includes('site') && /terreno/.test(v))
        || (!readiness.enabledPlaces.includes('work_area') && /area de obra|obra en construccion/.test(v))
        || (!readiness.enabledPlaces.includes('model') && /departamento modelo/.test(v))
      if(forbidden) {destinationRemoved=true;return false}
    }
    if(readiness?.primaryPlace==='none' && /(?:coordinar|agendar|recibirle|acercarse).*(?:visita|oficina|obra|departamento)|le gustaria.*visita/.test(v)) {destinationRemoved=true;return false}
    const permittedModel=!!readiness && /departamento modelo/.test(v) && readiness.enabledPlaces.includes('model')
    if (launch && !permittedModel && /(?:conozca|conocer|recorrer|visitar|ver) (?:personalmente )?(?:los |las |un |una |el )?(?:departamentos?|vistas|pisos altos)|visita.*(?:departamentos|vistas).*personalmente/.test(v)) { destinationRemoved = true; return false }
    if (!registered && /(?:solicitud|visita|cita).*(?:ha quedado|quedo|esta|hemos) registrad|(?:hemos|he) registrado.*(?:solicitud|visita|cita)/.test(v)) { claimRemoved = true; return false }
    const conditional = /(?:cuando|una vez que) (?:tengamos|recibamos|indique|nos indique|se registre|quede registrada)|indiquenos que (?:fecha|dia).*hora/.test(v)
    if(!registered && visitContext && !conditional && (
      /(?:el equipo|el asesor) (?:revisara|confirmara|verificara|le propondra)|le confirmaremos|le (?:avisaremos|propondremos).*horario/.test(v)
      || /(?:tomo|tomamos|tomada) en cuenta.*(?:preferencia|visita)|preferencia.*(?:tomada en cuenta|recibida)/.test(v)
    )) {claimRemoved=true;return false}
    if (/en el transcurso de hoy|pronto recibira.*confirmacion|(?:confirm|comunicaremos|respuesta).*antes del (?:sabado|lunes|martes|miercoles|jueves|viernes|domingo)/.test(v)) { deadlineRemoved = true; return false }
    return true
  })
  if (destinationRemoved) kept.unshift(readiness ? readinessInvitation(readiness)||'Por el momento no hay visitas presenciales habilitadas.' : office ? 'Podemos recibirle en nuestra oficina para revisar los planos y el material del proyecto; todavía no hay departamentos terminados para recorrer.' : 'Podemos coordinar una visita al terreno donde se construirá el proyecto; todavía no hay departamentos terminados para recorrer.')
  if (claimRemoved) kept.push('Todavía no puedo confirmar que su solicitud de visita haya quedado registrada.')
  if (deadlineRemoved) kept.push(registered ? 'Aún no tengo una hora de confirmación; le avisaremos cuando el equipo verifique la disponibilidad.' : 'Aún no hay una hora de confirmación disponible.')
  return destinationRemoved || claimRemoved || deadlineRemoved ? kept.join(' ') : reply
}

export const VISIT_NATURAL_RULES = '\nAl iniciar una coordinación, muestre los días y horas de atención configurados antes de pedir fecha y hora. Al recibir un horario, responda de forma directa: «Revisaremos la disponibilidad para recibirle…». No describa la validación interna con frases como «es una opción dentro de nuestro horario de atención». Repita los horarios si la preferencia queda fuera o si el cliente pide ayuda para elegir. No prometa confirmación hoy, pronto o antes de una fecha sin un plazo verificado. Solo afirme que la solicitud está registrada si el resultado operativo lo respalda.\n'
