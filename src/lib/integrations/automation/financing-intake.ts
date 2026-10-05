import { createHash } from 'node:crypto'
import { text, type Row } from './data'
import { financingPendingFields, financingReply } from './financing'
import { financingNameQuestion } from './financing-identity'

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const intakeFragmentKey = (value: string) => createHash('sha256').update(normalized(value)).digest('hex')

/** Only literal personal-data declarations are exempt from business-gap
 * handoffs. Keep hashes in the audit; never duplicate the document there. A
 * mixed message's business question is deliberately not covered by this set. */
export function personalDataFragments(current: string, identity: Row, document: Row) {
  const names = new Set(normalized(text(identity.full_name)).split(/[^\p{L}]+/u).filter(Boolean))
  const words = new Set('me llamo mi nombre nombres apellido apellidos completo completos es son soy yo y el la de del numero cedula identidad documento este esta aqui gracias bien bueno ya por favor'.split(' '))
  const hasDocument = ['accepted', 'invalid_length', 'incomplete'].includes(text(document.status))
  return [...new Set([current, ...current.split(/\n+|[;!?¿]/)].filter(fragment => {
    if (!fragment.trim() || /[?¿]/.test(fragment)) return false
    let value = normalized(fragment)
    if (hasDocument) value = value.replace(/\b\d[\d .-]*\d\b/g, ' ')
    const tokens = value.split(/[^\p{L}\d]+/u).filter(Boolean)
    const hasName = tokens.some(token => names.has(token))
    return (hasName || hasDocument && /\d/.test(fragment)) && tokens.every(token => names.has(token) || words.has(token))
  }).map(intakeFragmentKey))]
}

/** The persisted application is the authority for missing fields and lender. */
export function financingCollection(fin: Row, identity: Row, document: Row, partners: string[], unsupported = '') {
  const pending = financingPendingFields(fin)
  const invalidDocument = ['invalid_length', 'incomplete'].includes(text(document.status))
  const basic = ['legal_name', 'national_id', 'applicant_type'].filter(field => pending.includes(field))
  const collectBasics = !unsupported && (invalidDocument || !!fin.selected_partner_name && basic.length > 0)
  let reply = financingReply(fin, partners, unsupported)
  const requested = collectBasics ? basic : pending.slice(0, 1)
  if (collectBasics) {
    const parts: string[] = []
    if (invalidDocument) parts.push(document.status === 'incomplete'
      ? 'El número quedó incompleto. Por favor, complete los diez dígitos de su cédula.'
      : 'El número que envió no corresponde al formato de una cédula de diez dígitos. Por favor, indíqueme su cédula de diez dígitos.')
    if (basic.includes('legal_name')) parts.push(financingNameQuestion(identity))
    if (basic.includes('national_id') && !invalidDocument) parts.push('Por favor, indíqueme también su número de cédula de diez dígitos.')
    if (basic.includes('applicant_type')) parts.push('¿Trabaja bajo relación de dependencia o de manera independiente?')
    reply = parts.join(' ')
  }
  return { reply, collection: { state: fin.state, next_question: reply,
    pending_fields: pending, requested_fields: requested, selected_partner: text(fin.selected_partner_name) || null,
    legal_name_complete: fin.legal_name_confirmed === true, document_validation: document,
    instruction: 'Solicite los requested_fields sin repetir campos completos. Corrija el documento si corresponde y conserve los nombres/apellidos y situación laboral pendientes. No solicite RUC. Son datos que aclara el cliente, no información del proyecto que requiera un asesor.' } }
}
