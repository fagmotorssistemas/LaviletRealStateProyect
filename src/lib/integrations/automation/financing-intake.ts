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
  // RPC v3 reaches continuacion_pendiente before every personal-data state
  // when consent is absent. Choosing a lender never bypasses that gate. The
  // persisted state carries consent because the RPC does not return its flag.
  const state = text(fin.state || fin.financing_state)
  const consentRequired = state === 'continuacion_pendiente' || fin.explicit_consent === false
  const effective = consentRequired ? { ...fin, state: 'continuacion_pendiente' } : fin
  const pending = financingPendingFields(fin)
  const invalidDocument = ['invalid_length', 'incomplete'].includes(text(document.status))
  const basic = ['legal_name', 'national_id', 'applicant_type'].filter(field => pending.includes(field))
  const collectionAllowed = !consentRequired && !unsupported
    && !['entidad_pendiente', 'lista_para_revision'].includes(state)
  const collectBasics = collectionAllowed && (invalidDocument || !!fin.selected_partner_name && basic.length > 0)
  let reply = financingReply(effective, partners, unsupported)
  const requested = unsupported ? [] : consentRequired ? ['financing_consent']
    : state === 'entidad_pendiente' ? ['selected_partner_name']
      : state === 'lista_para_revision' ? [] : collectBasics ? basic : pending.slice(0, 1)
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
  return { reply, collection: { state: effective.state || effective.financing_state, next_question: reply,
    pending_fields: consentRequired ? ['financing_consent', ...pending] : pending,
    requested_fields: requested, selected_partner: text(fin.selected_partner_name) || null,
    consent_required: consentRequired, collection_allowed: collectionAllowed,
    legal_name_complete: fin.legal_name_confirmed === true, document_validation: document,
    instruction: consentRequired
      ? 'La entidad elegida es una preferencia, no consentimiento. Pregunte únicamente si desea iniciar la revisión, conservando selected_partner. No solicite nombre legal, cédula, empleo ni ingresos, tampoco la corrección de un documento entregado antes de aceptar. Los demás pending_fields esperan su autorización.'
      : !collectionAllowed
        ? 'Conserve next_question y solicite únicamente requested_fields. La recopilación de datos personales todavía no corresponde; no solicite ni corrija documentos, nombre legal, empleo o ingresos. Conserve la entidad ya elegida si sigue habilitada.'
        : 'Solicite los requested_fields sin repetir campos completos. Corrija el documento si corresponde y conserve los nombres/apellidos y situación laboral pendientes. No solicite RUC. Son datos que aclara el cliente, no información del proyecto que requiera un asesor.' } }
}
