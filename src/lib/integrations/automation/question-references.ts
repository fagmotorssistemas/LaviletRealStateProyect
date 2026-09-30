import { object, text, type Row } from './data'

export type RequestReference = { id: string; text: string }

/** References own their source text. The reviewer selects IDs, never quotations. */
export function requestReferences(current: string, requests: Row[] = []): RequestReference[] {
  const fragments = [current, ...requests.map(row => text(row.fragment))]
    .filter(fragment => fragment.trim() && current.includes(fragment))
  return [...new Set(fragments)].slice(0, 13).map((fragment, index) => ({ id: `R${index + 1}`, text: fragment }))
}

export function questionReferenceSchema(schema: Row, references: RequestReference[]): Row {
  const properties = { ...object(schema.properties) }, question = object(properties.question)
  const questionProperties = { ...object(question.properties) }
  delete questionProperties.clarifies
  questionProperties.clarifies_request_ids = { type: 'array', maxItems: references.length,
    items: { type: 'string', enum: references.length ? references.map(row => row.id) : ['none'] },
    description: 'IDs de referencias_solicitud que esta pregunta aclara. No copie frases. Vacío si no aclara una solicitud.' }
  properties.question = { ...question, properties: questionProperties,
    required: [...new Set([...(question.required as string[]).filter(key => key !== 'clarifies'), 'clarifies_request_ids'])] }
  return { ...schema, properties }
}

export function resolveQuestionReferences(question: Row, references: RequestReference[]) {
  const warnings: Row[] = [], legacy = question.clarifies_request_ids === undefined
  const raw = legacy ? question.clarifies : question.clarifies_request_ids
  const selected: RequestReference[] = []
  if (!Array.isArray(raw)) warnings.push({ code: 'question_reference_list_missing' })
  else for (const entry of raw.slice(0, 13)) {
    const reference = references.find(row => legacy ? row.text === entry : row.id === entry)
    if (reference && question.purpose === 'clarify_request') selected.push(reference)
    else warnings.push({ code: 'question_reference_ignored', reference: entry })
  }
  // Invalid trace metadata cannot veto prose or resolve an unrelated missing fact.
  const unique = [...new Map(selected.map(row => [row.id, row])).values()]
  return { clarifies: unique.map(row => row.text), clarifies_request_ids: unique.map(row => row.id), warnings }
}
