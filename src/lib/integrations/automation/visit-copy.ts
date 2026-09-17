import type { Row } from './data'

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
  return issues
}
