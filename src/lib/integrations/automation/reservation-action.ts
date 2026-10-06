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

/** A quoted wish cannot omit an unresolved prerequisite elsewhere in the turn.
 * This is a permission veto, not another classifier: an unconditional request
 * still requires the extractor's high-confidence, literal reservation proof. */
export function reservationPermission(reservation: Row, current: string): Row {
  if (reservation.kind !== 'request' || reservation.confidence !== 'high') return reservation
  const turn = permissionText(current), proof = permissionText(value(reservation.evidence))
  if (!proof || !turn.includes(proof)) return reservation
  const pendingCheck = [...turn.matchAll(/\b(?:ver|saber|revisar|evaluar|comprobar|confirmar|averiguar)\s+(?:primero\s+)?si\s+([^.!?\n]+)/g)].some(match => {
    const clause = match[1], prefix = turn.slice(0, match.index)
    const before = prefix.slice(Math.max(prefix.lastIndexOf('.'), prefix.lastIndexOf('!'), prefix.lastIndexOf('?'), prefix.lastIndexOf(';')) + 1)
    if (/\bno\s+(?:(?:necesito|quiero|deseo|quisiera|hace falta)\s+)?$/.test(before)
      || /\bya\s+(?:comprobe|confirme|verifique|revise|resolvi)\b/.test(before + ' ' + clause)) return false
    // Feasibility of this purchase is a prerequisite. A separate question such
    // as "saber si entrega en 2028" or "saber si tiene ascensor" is not one.
    const feasibility = /\b(?:alcanz\w*|puedo pagar|podemos pagar|puedo comprar|podemos comprar|me aprueban|nos aprueban|entra en mi presupuesto|dentro de mi presupuesto|dinero suficiente)\b/.test(clause)
      || /\b(?:asequible|costeable)\b/.test(clause) && /\b(?:precio|valor|costo|compra|presupuesto)\b/.test(clause)
    const precedence = /\b(?:primero|antes de|antes quiero|antes necesito|antes quisiera)\b/.test(before)
    return feasibility || precedence
  })
  // Keep accented affirmative "sí" distinct from a conditional "si".
  // Read the surrounding current clause as well: the model may have quoted
  // only "quiero reservar" and omitted a binding "si cuesta ..." afterwards.
  const literalTurn = normalize(current), literalEvidence = normalize(value(reservation.evidence))
  const at = literalTurn.lastIndexOf(literalEvidence), end = at + literalEvidence.length
  const beforeBoundary = Math.max(literalTurn.lastIndexOf('.', at - 1), literalTurn.lastIndexOf('!', at - 1), literalTurn.lastIndexOf('?', at - 1))
  const followingBoundary = literalTurn.slice(end).search(/[.!?]/)
  const enclosingClause = literalTurn.slice(beforeBoundary + 1, followingBoundary < 0 ? undefined : end + followingBoundary)
  const literalProof = enclosingClause.replace(/\bsi\b/g, (word, index: number) => {
    const prefix = enclosingClause.slice(0, index)
    const queryAt = [...prefix.matchAll(/\b(?:ver|saber|revisar|evaluar|comprobar|confirmar|averiguar)\b/g)].at(-1)?.index ?? -1
    const actionAt = [...prefix.matchAll(/\b(?:reserv\w*|separ\w*|serpar\w*|apart\w*|asegur\w*)\b/g)].at(-1)?.index ?? -1
    // "Reservar y saber el precio y si hay financiamiento" is an independent
    // indirect question; "saber el precio y reservar si ..." is conditional.
    return queryAt > actionAt ? 'consulta_indirecta' : word
  })
  const conditionProof = permissionText(literalProof)
  const conditionalProof = /\b(?:solo si|siempre que|a condicion de|dependiendo de|cuando se confirme|hasta que)\b/.test(conditionProof)
    || /\bsi\s+(?!(?:quiero|quisiera|deseo|acepto|autorizo|necesito|me interesa|me gustar[ií]a|por favor|claro|correcto|de acuerdo)\b)\S/.test(literalProof)
    || /\b(?:primero|antes de)\b[^.!?;]{0,100}\b(?:conocer|revisar|confirmar|evaluar|saber|ver)\b/.test(conditionProof)
  // A prerequisite in another message of the same batch is equally binding.
  // Plain questions about a price do not imply a condition on their own.
  if (!pendingCheck && !conditionalProof) return reservation
  return { ...reservation, kind: 'information', request_deferred: true,
    permission_reason: 'reservation_prerequisite_unresolved' }
}

/** A substring cannot remove the local negation that governs the requested action. */
function negatesQuotedPermission(before: string, evidence: string) {
  const prefix = permissionText(before) + (/\s$/.test(before) ? ' ' : ''), quoted = permissionText(evidence)
  const adjacent = /\b(?:no|nunca|tampoco)\s+(?:(?:quiero|deseo|necesito|autorizo|acepto|puedo|podemos|voy|vamos|me interesa|me gustaria)\s+(?:(?:que|a)\s+)?)?$/.test(prefix)
  const deniedAction = /\b(?:no|nunca|tampoco)\s+(?:(?:quiero|deseo|necesito|autorizo|acepto|puedo|podemos|voy|vamos|me interesa|me gustaria)\s+(?:(?:que|a)\s+)?)?(?:reserv\w*|separ\w*|apart\w*)\b/.test(quoted)
  return adjacent || deniedAction
}

/** Select the persisted message supplying the proof, including batched turns. */
export function reservationRequest(reservation: Row, messages: { externalId: string; text: string }[], catalog: Row[], selected: Row[]) {
  reservation = reservationPermission(reservation, messages.map(message => message.text).join('\n'))
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

/** An absent function did not execute the write. Do not substitute a different
 * handoff, drop evidence arguments, or replay a timeout with an uncertain result. */
export async function requestReservationHandoff(call: (name: string, args: Row) => Promise<unknown>, args: Row) {
  try {
    const result = await call('lv_request_reservation_handoff', args)
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('RESERVATION_HANDOFF_CONTRACT_MISMATCH')
    return { status: 'recorded' as const, receipt: result as Row }
  } catch (error) {
    if (!(error instanceof Error) || !/^RPC_LV_REQUEST_RESERVATION_HANDOFF_(PGRST202|42883)$/.test(error.message)) throw error
    return { status: 'unavailable' as const, error_code: error.message, action_executed: false as const }
  }
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
