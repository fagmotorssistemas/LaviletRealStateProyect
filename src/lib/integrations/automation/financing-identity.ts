import { object, text, type Row } from './data'

const literal = (quote: unknown, message: string) => !!text(quote).trim()
  && message.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())
const nullable = { type: ['string', 'null'] }
export const FINANCING_IDENTITY_SCHEMA = { anyOf: [{ type: 'null' }, {
  type: 'object', additionalProperties: false,
  properties: { given_names: nullable, surnames: nullable, evidence: { type: 'string' },
    complete_name_confirmation: nullable, document: nullable },
  required: ['given_names', 'surnames', 'evidence', 'complete_name_confirmation', 'document'],
}] }

export const FINANCING_IDENTITY_RULES = `Identidad para financiamiento: full_name de presentación no acredita nombre legal completo. En financing_identity separe given_names y surnames SOLO cuando el mensaje los aporta inequívocamente; no invente componentes ni copie el nombre de WhatsApp. evidence cita literalmente la declaración actual. Un nombre aislado, como Carlos, no aporta apellidos. complete_name_confirmation cita una confirmación explícita de que estos son TODOS sus nombres y apellidos, o una aclaración de que solo tiene un nombre/apellido; null si no lo afirma. Una respuesta afirmativa a una pregunta expresa de confirmar el nombre legal completo puede confirmar el nombre pendiente sin repetirlo. Los apellidos compuestos cuentan como apellidos, no como palabras independientes. document conserva el número COMPLETO que presenta como identificación, incluso si su longitud es incorrecta. Nunca recorte, rellene ni arregle números. Siempre se solicita cédula, nunca RUC, incluso a independientes. Si ofrece un RUC, consérvelo crudo para validación del sistema. Un monto de dinero no es un documento.`

/** A declared display name cannot silently become an application's legal name. */
export function financingIdentity(previous: Row, raw: unknown, current: string, lastQuestion = ''): Row {
  const data = object(raw), supported = literal(data.evidence, current)
  let given = text(previous.given_names), surnames = text(previous.surnames)
  const validPart = (value: unknown) => supported && literal(value, text(data.evidence))
    && /^[\p{L} .’'-]+$/u.test(text(value))
  const provided = validPart(data.given_names) || validPart(data.surnames)
  if (validPart(data.given_names)) given = text(data.given_names).trim()
  if (validPart(data.surnames)) surnames = text(data.surnames).trim()
  const changed = given !== text(previous.given_names) || surnames !== text(previous.surnames)
  const confirmation = literal(data.complete_name_confirmation, current)
  const confirmingKnownName = !changed && !!previous.full_name
    && /(?:todos|completo|tal como).*(?:nombre|apellido|c[eé]dula)|(?:nombre|apellido).*completo/i.test(lastQuestion)
  const complete = !!given && !!surnames && (confirmation && (provided || confirmingKnownName)
    || !changed && previous.complete === true)
  return { ...previous, given_names: given || null, surnames: surnames || null,
    full_name: [given, surnames].filter(Boolean).join(' ') || null, complete,
    ...(provided || confirmation ? { evidence: data.evidence, confirmation: confirmation ? data.complete_name_confirmation : null } : {}) }
}

export function financingNameQuestion(identity: Row) {
  if (identity.given_names && identity.surnames && identity.complete !== true)
    return `¿Me confirma si «${text(identity.full_name)}» incluye todos sus nombres y apellidos tal como aparecen en su cédula? Si tiene un solo nombre o apellido, está bien.`
  return 'Para la revisión, ¿me indica sus nombres y apellidos completos tal como aparecen en su cédula? Incluya sus dos nombres y dos apellidos si los tiene; si tiene solo uno, puede indicarlo.'
}

/** Validate the supplied field, not numbers in a generated reply. No checksum or
 * identity-authentication claim is made by this length/format check. */
export function financingDocument(raw: unknown, current: string): Row {
  const original = text(raw).trim(), digits = original.replace(/[\s.-]/g, '')
  if (!original || !/^\d+$/.test(digits)) return { status: 'absent', national_id: null }
  const compactMessage = current.replace(/[\s.-]/g, '')
  if (!new RegExp(`(?:^|\\D)${digits}(?:$|\\D)`).test(compactMessage)) return { status: 'unsubstantiated', national_id: null }
  if (digits.length === 10) return { status: 'accepted', national_id: digits, source: 'cedula', digit_count: 10 }
  // Natural persons with a cédula have a third digit from 0 to 5. A company
  // RUC (third digit 9/6) or a different suffix must never be cut into a cédula.
  if (digits.length === 13 && /^(?:0[1-9]|1\d|2[0-4]|30)[0-5]\d{7}001$/.test(digits))
    return { status: 'accepted', national_id: digits.slice(0, 10), source: 'personal_ruc', digit_count: 13 }
  return { status: digits.length < 10 ? 'incomplete' : 'invalid_length', national_id: null,
    digit_count: digits.length, instruction: digits.length < 10
      ? 'El número quedó incompleto. Pida completar los diez dígitos de la cédula, sin llamarlo un error.'
      : 'Explique que el número recibido no corresponde al formato de una cédula de diez dígitos ni al RUC personal admitido. Pida la cédula de diez dígitos. No solicite RUC, no repita el número ni lo dé por recibido correctamente.' }
}
