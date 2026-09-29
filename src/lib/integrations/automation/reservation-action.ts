import type { Row } from './data'

const value = (input: unknown) => typeof input === 'string' ? input : ''
const normalize = (input: unknown) => value(input).toLocaleLowerCase('es').replace(/\s+/g, ' ').trim()
const unitKey = (input: unknown) => {
  const match = normalize(input).match(/^(lc[- ]*)?(\d{1,4})$/)
  return match ? `${match[1] ? 'lc-' : ''}${Number(match[2])}` : ''
}
const unitMentioned = (input: string, number: string) => {
  const key = unitKey(number)
  if (!key) return false
  const commercial = key.startsWith('lc-')
  const digits = commercial ? key.slice(3) : key
  return new RegExp(`(?:^|[^0-9])${commercial ? '(?:lc[- ]*|local(?: comercial)?\\s+)' : ''}0*${digits}(?!\\d)`, 'i').test(normalize(input))
}
const permissionText = (input: string) => normalize(input).normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** A substring cannot remove the local negation that governs the requested action. */
function negatesQuotedPermission(before: string, evidence: string) {
  const prefix = permissionText(before) + (/\s$/.test(before) ? ' ' : ''), quoted = permissionText(evidence)
  const adjacent = /\b(?:no|nunca|tampoco)\s+(?:(?:quiero|deseo|necesito|autorizo|acepto|puedo|podemos|voy|vamos|me interesa|me gustaria)\s+(?:(?:que|a)\s+)?)?$/.test(prefix)
  const deniedAction = /\b(?:no|nunca|tampoco)\s+(?:(?:quiero|deseo|necesito|autorizo|acepto|puedo|podemos|voy|vamos|me interesa|me gustaria)\s+(?:(?:que|a)\s+)?)?(?:reserv\w*|separ\w*|apart\w*)\b/.test(quoted)
  return adjacent || deniedAction
}

/** Select the persisted message supplying the proof, including batched turns. */
export function reservationRequest(reservation: Row, messages: { externalId: string; text: string }[], catalog: Row[], selected: Row[]) {
  if (reservation.kind !== 'request' || reservation.confidence !== 'high') return null
  const evidence = value(reservation.evidence).trim()
  if (!evidence) return null
  const persisted = [...new Map(messages.filter(message => message.externalId && normalize(message.text)).map(message => [message.externalId, message])).values()]
  let combined = ''
  const spans = persisted.map(message => {
    const start = combined.length + (combined ? 1 : 0)
    combined += `${combined ? ' ' : ''}${normalize(message.text)}`
    return { ...message, start, end: combined.length }
  })
  const normalizedEvidence = normalize(evidence)
  const start = combined.lastIndexOf(normalizedEvidence)
  if (start < 0) return null
  const proof = spans.filter(message => message.end > start && message.start < start + normalizedEvidence.length)
  if (!proof.length) return null
  // A separate "por ahora no" message can answer the prior proposal. Do not
  // splice it onto the new request as though both belonged to one clause.
  if (negatesQuotedPermission(combined.slice(Math.max(proof[0].start, start - 100), start), normalizedEvidence)) return null
  const numbers = [...new Set((Array.isArray(reservation.unit_numbers) ? reservation.unit_numbers : []).map(unitKey).filter(Boolean))]
  const available = catalog.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
  const mentioned = available.filter(unit => unitMentioned(combined, value(unit.unit_number)))
  const selectedUnits = selected.filter(unit => available.some(candidate => candidate.id === unit.id))
  const explicitUnit = /\b(?:unidad|depart\w*|apart\w*|suite|penthouse|local(?: comercial)?|el|la)\s*(?:n[uú]mero\s*)?(?:lc[- ]*)?\d{1,4}(?!\d)/i.test(combined)
  const canResolveSelection = selectedUnits.length === 1 && mentioned.length === 0 && !explicitUnit
  // A stated but unknown unit must never silently become a previously selected unit.
  // Model numbers also need literal support in this batch or the one confirmed
  // selection. A catalogue match alone cannot invent the customer's referent.
  const units = numbers.length ? available.filter(unit => numbers.includes(unitKey(unit.unit_number))
    && (mentioned.some(candidate => candidate.id === unit.id) || canResolveSelection && selectedUnits[0].id === unit.id))
    : canResolveSelection ? selectedUnits : []
  const proofIds = new Set(proof.map(message => message.externalId))
  for (const message of spans) if (units.some(unit => unitMentioned(message.text, value(unit.unit_number)))) proofIds.add(message.externalId)
  const proofMessages = spans.filter(message => proofIds.has(message.externalId))
  return { source_message_id: proofMessages.at(-1)!.externalId, evidence, evidence_message_ids: proofMessages.map(message => message.externalId),
    unit_ids: units.map(unit => value(unit.id)), unit_numbers: units.map(unit => value(unit.unit_number)),
    unresolved_unit_numbers: numbers.filter(number => !units.some(unit => unitKey(unit.unit_number) === number)) }
}

export function verifiedReservationReceipt(receipt: Row, lead: Row, request: NonNullable<ReturnType<typeof reservationRequest>>) {
  const units = Array.isArray(receipt.unit_ids) ? receipt.unit_ids.map(value).sort() : []
  const assigned = ['assigned', 'acknowledged'].includes(value(receipt.handoff_status))
  return Boolean(receipt.request_id) && receipt.lead_id === lead.id && receipt.source_message_id === request.source_message_id
    && receipt.request_status === 'requested' && ['assigned', 'acknowledged', 'queued'].includes(value(receipt.handoff_status))
    && JSON.stringify(units) === JSON.stringify([...request.unit_ids].sort())
    && lead.handoff_status === receipt.handoff_status
    && (assigned ? Boolean(receipt.assigned_to) && lead.assigned_to === receipt.assigned_to : !receipt.assigned_to && !lead.assigned_to)
}

/** Only an absent function permits legacy fallback; ambiguous writes are retried idempotently. */
export async function evaluateInterestDecision(call: (name: string, args: Row) => Promise<unknown>, args: Row): Promise<Row> {
  try {
    const result = await call('lv_evaluate_message_interest_v2', args)
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Row
    throw new Error('INTEREST_DECISION_CONTRACT_MISMATCH')
  } catch (error) {
    if (!(error instanceof Error) || !/^RPC_LV_EVALUATE_MESSAGE_INTEREST_V2_(PGRST202|42883)$/.test(error.message)) throw error
    await call('lv_evaluate_message_interest', args)
    return { decision_source: 'legacy_without_receipt', source_message_id: args.p_source_message_id,
      recognized_events: args.p_events, handoff_required: null, handoff_reason: null }
  }
}
