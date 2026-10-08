import { object, text, type Row } from './data'

/** Keep labels as declared, including non-Latin names; normalization is only for evidence checks. */
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const words = (value: string) => fold(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const contains = (quote: string, value: string) => !!words(value) && ` ${words(quote)} `.includes(` ${words(value)} `)
const literal = (quote: string, current: string) => !!quote && quote.length <= 500
  && current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
const label = (value: unknown) => { const v = text(value).trim(); return v && v.length <= 150 ? v : '' }

/** Only the conversation profile can establish a conversational name. CRM and
 * WhatsApp display labels are deliberately not inputs to this projection. */
export function confirmedLeadProfile(profileInput: unknown): Row {
  const profile = object(profileInput), sources = { ...object(profile.sources) }
  const name = label(profile.full_name), source = object(sources.full_name)
  const evidence = text(source.evidence || object(profile.evidence).full_name).trim()
  const declared = ['lead_declaration', 'lead_confirmation'].includes(text(source.source))
    || !Object.keys(source).length && !!text(object(profile.evidence).full_name)
  const confirmed = !!name && declared && !!evidence && contains(evidence, name)
  if (!confirmed) delete sources.full_name
  return { ...profile, full_name: confirmed ? name : null, name_status: confirmed ? 'confirmed' : 'unconfirmed',
    sources, evidence: { ...object(profile.evidence), full_name: confirmed ? evidence : null } }
}

export function confirmedLeadName(profileInput: unknown): string {
  return text(confirmedLeadProfile(profileInput).full_name)
}

/** A shared citation can contain either one ambiguous place declaration or
 * several compatible assertions. Only semantic recovery decides which; the
 * provenance check does not inspect residence verbs or guess current residence. */
export function leadProfileSourceIssues(raw: Row, current: string): string[] {
  const normalized = normalizeLeadProfile(raw, current, {})
  return (Array.isArray(normalized.diagnostics) ? normalized.diagnostics : []).some(value =>
    typeof value === 'string' && value.endsWith('_noncurrent_location_source_conflict'))
    ? ['ambiguous_profile_location_source'] : []
}

/** The extractor owns meaning; this boundary checks structure and provenance only.
 * Evidence is an audit citation, never a second natural-language classifier. */
export function normalizeLeadProfile(raw: Row, current: string, input: Row): Row {
  const pending = object(input.pregunta_pendiente), profile = object(input.perfil_inicial)
  const evidence = object(raw.profile_evidence), accepted: Row = { full_name: null, residence_city: null, residence_country: null }
  const values: Row = { full_name: null, residence_city: null, residence_country: null }
  const diagnostics: string[] = []
  const validValue = (value: unknown, quote: unknown) => !!label(value) && literal(text(quote), current) && contains(text(quote), label(value))
  for (const key of ['full_name', 'residence_city', 'residence_country']) {
    const value = label(raw[key]), quote = text(evidence[key]).trim()
    if (!value) continue
    if (!validValue(value, quote)) { diagnostics.push(key + '_invalid_provenance'); continue }
    values[key] = value; accepted[key] = quote
  }
  let declared: Row | null = null
  const proposed = object(raw.declared_location), kind = text(proposed.kind), quote = text(proposed.evidence).trim()
  if (['origin', 'temporary', 'former', 'future', 'unspecified'].includes(kind) && literal(quote, current)) {
    const location: Row = { city: null, country: null, kind, evidence: quote }
    for (const field of ['city', 'country']) if (validValue(proposed[field], quote)) location[field] = label(proposed[field])
    if (location.city || location.country) declared = location
  }
  // One citation classified as a non-current location cannot simultaneously
  // certify current residence. A separate current assertion can refer to the
  // same city (including an anaphoric "allí") with its own contextual citation.
  if (declared) for (const [key, field] of [['residence_city', 'city'], ['residence_country', 'country']]) {
    const sharedCitation = fold(text(accepted[key])).replace(/\s+/g, ' ').trim() === fold(quote).replace(/\s+/g, ' ').trim()
    if (values[key] && words(text(values[key])) === words(text(declared[field])) && sharedCitation) {
      values[key] = null; accepted[key] = null
      diagnostics.push(key + '_noncurrent_location_source_conflict')
    }
  }
  let confirmation: Row | null = null
  const candidate = object(profile.residence_candidate), target = object(pending.residence_candidate)
  const sameCandidate = !!(label(candidate.city) || label(candidate.country))
    && words(text(candidate.city)) === words(text(target.city)) && words(text(candidate.country)) === words(text(target.country))
  const proposedConfirmation = object(raw.residence_confirmation), decision = text(proposedConfirmation.decision)
  const confirmationQuote = text(proposedConfirmation.evidence).trim()
  const answer = object(object(raw.turn_semantics).answer_to_previous)
  const contradictsPendingAnswer = Object.keys(answer).length > 0 && (answer.question_id !== 'lead_residence_confirmation' || answer.kind === 'none')
  const declaredCandidateDiffers = declared && ['origin', 'unspecified'].includes(text(declared.kind))
    && ((declared.city && words(text(declared.city)) !== words(text(candidate.city)))
      || (declared.country && words(text(declared.country)) !== words(text(candidate.country))))
  if (text(pending.id) === 'lead_residence_confirmation' && sameCandidate && ['confirm', 'deny'].includes(decision)
    && !contradictsPendingAnswer && !declaredCandidateDiffers
    && proposedConfirmation.confidence === 'high' && literal(confirmationQuote, current)) {
    confirmation = { decision, evidence: confirmationQuote, confidence: 'high' }
  }
  // Explicit current residence always wins over an earlier place or a bare confirmation.
  let status = 'unknown', residenceCandidate: Row | null = null
  if (values.residence_city || values.residence_country) {
    status = 'confirmed'; diagnostics.push('residence_declared_explicitly_or_answered')
    if (confirmation) { confirmation = null; diagnostics.push('residence_declaration_overrides_confirmation') }
  } else if (confirmation?.decision === 'confirm') {
    for (const [key, field] of [['residence_city', 'city'], ['residence_country', 'country']]) {
      if (!label(candidate[field])) continue
      values[key] = candidate[field]; accepted[key] = confirmation.evidence
    }
    status = 'confirmed'; diagnostics.push('residence_candidate_confirmed')
  } else if (confirmation?.decision === 'deny') {
    status = 'unknown'; diagnostics.push('residence_candidate_denied')
  } else if (object(raw.residence_response).status === 'declined'
    && literal(text(object(raw.residence_response).evidence), current)) {
    status = 'declined'; diagnostics.push('residence_collection_declined')
  } else if (declared && ['origin', 'unspecified'].includes(text(declared.kind))) {
    status = 'pending_confirmation'
    residenceCandidate = { city: declared.city, country: declared.country, evidence: declared.evidence }
    diagnostics.push('declared_location_needs_residence_confirmation')
  } else if (declared) diagnostics.push('noncurrent_location_not_residence')
  if (text(pending.id) === 'lead_residence_confirmation' && proposedConfirmation.decision && !sameCandidate)
    diagnostics.push('residence_confirmation_target_mismatch')
  if (proposedConfirmation.decision && contradictsPendingAnswer) diagnostics.push('residence_confirmation_answer_mismatch')
  return { ...values, evidence: accepted, declared_location: declared, residence_candidate: residenceCandidate,
    residence_confirmation: confirmation, residence_status: status, diagnostics }
}

/** One durable profile state shared by routing, writing and validation; no guessed geography. */
export function mergeLeadProfile(previousInput: unknown, incomingInput: unknown, metadata: { message_id?: unknown; declared_at?: unknown } = {}): Row {
  const previous = object(previousInput), incoming = object(incomingInput)
  const result: Row = { ...previous }, sources = { ...object(previous.sources) }
  // Repair only a saved confirmation backed by the same conflicting citation.
  // A previously established residence with independent evidence remains valid.
  const conflicts = Array.isArray(incoming.diagnostics) ? incoming.diagnostics : []
  for (const key of ['residence_city', 'residence_country']) if (conflicts.includes(key + '_noncurrent_location_source_conflict')) {
    const oldSource = object(sources[key]), declaration = object(incoming.declared_location)
    if (words(text(oldSource.evidence)) === words(text(declaration.evidence)) && text(oldSource.evidence)) {
      delete result[key]; delete sources[key]
    }
  }
  const source = (evidence: unknown, kind = 'lead_declaration') => ({ source: kind, evidence: text(evidence), ...metadata })
  const fieldSource = (key: string, evidence: unknown, kind = 'lead_declaration') => !Object.keys(metadata).length
    && Object.keys(object(sources[key])).length > 0 && text(object(sources[key]).evidence) === text(evidence) ? sources[key] : source(evidence, kind)
  const confirmed = !!(label(incoming.residence_city) || label(incoming.residence_country))
  if (confirmed) {
    const newCity = label(incoming.residence_city), newCountry = label(incoming.residence_country)
    const changed = newCity && words(newCity) !== words(text(previous.residence_city))
      || newCountry && words(newCountry) !== words(text(previous.residence_country))
    if (changed) for (const key of ['residence_city', 'residence_country']) {
      if (!label(incoming[key])) { delete result[key]; delete sources[key] }
    }
  }
  for (const key of ['full_name', 'residence_city', 'residence_country']) {
    if (!label(incoming[key])) continue
    result[key] = label(incoming[key]); sources[key] = fieldSource(key, object(incoming.evidence)[key],
      key !== 'full_name' && object(incoming.residence_confirmation).decision === 'confirm' ? 'lead_confirmation' : 'lead_declaration')
  }
  if (incoming.declared_location && Object.keys(object(incoming.declared_location)).length) {
    result.declared_location = incoming.declared_location
    sources.declared_location = fieldSource('declared_location', object(incoming.declared_location).evidence)
  }
  const confirmation = object(incoming.residence_confirmation)
  if (Object.keys(confirmation).length) result.residence_confirmation = { ...object(previous.residence_confirmation), ...confirmation, ...metadata }
  if (confirmed) {
    result.residence_status = 'confirmed'; result.residence_candidate = null
    delete sources.residence_candidate
  } else if (confirmation.decision === 'deny') {
    result.rejected_residence_candidate = { ...object(previous.rejected_residence_candidate), ...object(previous.residence_candidate), ...source(confirmation.evidence, 'lead_denial') }
    result.residence_candidate = null; delete sources.residence_candidate
    result.residence_status = result.residence_city || result.residence_country ? 'confirmed' : 'unknown'
  } else if (incoming.residence_status === 'declined') {
    result.residence_status = 'declined'; result.residence_candidate = null; delete sources.residence_candidate
  } else if (incoming.residence_candidate && !(result.residence_city || result.residence_country)) {
    result.residence_candidate = incoming.residence_candidate; result.residence_status = 'pending_confirmation'
    sources.residence_candidate = fieldSource('residence_candidate', object(incoming.residence_candidate).evidence)
  } else if (!result.residence_status) result.residence_status = result.residence_city || result.residence_country ? 'confirmed' : 'unknown'
  result.sources = sources
  result.name_status = confirmedLeadName(result) ? 'confirmed' : 'unconfirmed'
  result.diagnostics = Array.isArray(incoming.diagnostics) ? incoming.diagnostics : []
  return result
}

export const LEAD_PROFILE_EXTRACTION_RULES = `
Usted es responsable de interpretar semánticamente el perfil: identidad, residencia actual, negaciones, correcciones, temporalidad y respuestas a preguntas pendientes. El sistema NO vuelve a interpretar verbos ni mantiene una lista de expresiones permitidas. Use el significado y el contexto, incluso con errores ortográficos y formulaciones nuevas; no limite la residencia a las palabras vivo/resido. Una mudanza ya realizada que indica dónde vive ahora acredita residencia; una mudanza planeada no. No convierta nombres de terceros o del contacto de WhatsApp en el nombre declarado del lead.
residence_city/residence_country contienen solamente residencia ACTUAL inequívoca. Si es ambiguo, devuelva null y declared_location.kind=unspecified. Para residencia anterior use kind=former, para un destino futuro kind=future; ninguno es candidato actual. residence_response={status:declined,evidence:cita literal} solo si el lead rehúsa proporcionar su residencia; en otro caso null. Interprete afirmaciones y negaciones de confirmación antes de emitir residence_confirmation, sin limitarse a sí/no. Separe lugar declarado y residencia ACTUAL. declared_location conserva ciudad/pais y evidence literal: kind=origin para "soy de", nacimiento u origen; temporary para "escribo desde", viaje o vacaciones; unspecified solo para un lugar cuyo papel es ambiguo. Nunca borre un origen por no ser residencia.
"Soy de Cuenca" conserva Cuenca como origen y candidato por confirmar; NO llena residence_city ni residence_country, ni siquiera después de preguntar residencia. "Soy de Cuenca pero vivo en Guayaquil" conserva Cuenca en declared_location y Guayaquil como residence_city con evidencia "vivo en Guayaquil". Si nombra explícitamente la residencia no necesita confirmar el origen. La misma cita clasificada como origen, residencia antigua, temporal, futura o ambigua no puede acreditar simultáneamente residencia actual: cada afirmación debe tener su evidencia propia. Con origen y residencia actual en la misma ciudad, conserve ambos cuando el lead realmente afirma ambos: "Soy de Cuenca y sigo viviendo allí" usa declared_location.evidence="Soy de Cuenca" y profile_evidence.residence_city="Soy de Cuenca y sigo viviendo allí", porque esa cita contiene el lugar y su relación actual; no confunda repetir el origen con afirmar residencia.
Un país o una ciudad debe aparecer literalmente en su evidencia actual. No infiera país de ciudad, teléfono, nombre, proyecto ni historia. Lugares temporales, deseados, futuros, antiguos o negados no acreditan residencia. Nombre y perfil no eligen un inmueble ni autorizan una cita.
residence_confirmation solo puede responder pregunta_pendiente.id=lead_residence_confirmation y su residence_candidate, coincidente con perfil_inicial.residence_candidate. Para "sí" o "no" devuelva confirm/deny con evidence actual y confidence; no copie el lugar histórico como una declaración literal nueva. Una corrección explícita de residencia prevalece. Una aceptación de brochure, precio o cita no confirma residencia. Si no es una respuesta inequívoca a esa pregunta, devuelva null.
full_name es el nombre declarado con que desea ser llamado, no requiere apellidos. profile_evidence contiene evidencia literal actual para cada valor propuesto; no complete valores desde el historial ni invente un nombre del contacto de WhatsApp.
`
