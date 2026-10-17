import { object,type Row } from './data'

/** A field answer is interpreted by the common extractor, with its pending ID. */
export function financingFieldAnswer(_current: string, _history: unknown, qualification: Row, extracted: Row = {}): Row | null {
  if (qualification.explicit_consent !== true) return null
  const answer = object(object(extracted.turn_semantics).answer_to_previous)
  if (answer.question_id !== 'financing_data' || answer.kind !== 'value') return null
  const keys = ['job_title', 'employment_stability_months', 'applicant_type', 'monthly_income']
  const values = Object.fromEntries(keys.filter(key => extracted[key] != null).map(key => [key, extracted[key]]))
  return Object.keys(values).length ? values : null
}

export const FINANCING_COLLECTION_RULE = '\nEn recopilación de datos financieros, pida directamente el siguiente dato pendiente. No repita el dato recibido, la entidad ni la finalidad de cada pregunta. No agregue «esto permitirá», «este dato es necesario» ni supuestos requisitos internos de la entidad. Explique el propósito al iniciar, si es necesario para entender la solicitud o si el cliente pregunta. Incluso en modo explicativo, una respuesta simple a un campo no necesita una explicación adicional.\n'
export function financingCollectionIssues(_reply: string, _context: Row, _current = ''): boolean { void _current;  return false }
