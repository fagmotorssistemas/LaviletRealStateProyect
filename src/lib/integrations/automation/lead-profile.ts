import { object, text, type Row } from './data'

/** Keep labels as declared, including non-Latin names; normalization is only for evidence checks. */
const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
const words = (value: string) => fold(value).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
const contains = (quote: string, value: string) => !!words(value) && ` ${words(quote)} `.includes(` ${words(value)} `)
const literal = (quote: string, current: string) => !!quote && quote.length <= 500
  && current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
const label = (value: unknown) => { const v = text(value).trim(); return v && v.length <= 150 ? v : '' }

const residenceMarker = /\b(?:vivo|vivimos|resido|residimos|estoy viviendo|estamos viviendo|mi residencia (?:es|esta)|mi domicilio (?:es|esta)|estoy radicad[oa])\b/g
const originMarker = /\b(?:soy de|somos de|naci en|nacid[oa] en|mi (?:origen|lugar de origen) es)\b/g
const temporaryMarker = /\b(?:escribo desde|estoy en|estamos en|de viaje en|de vacaciones en|visitando)\b/g
const otherDeclaration = /\b(?:pero|aunque|sin embargo|(?:y )?(?:soy de|somos de|vivo|vivimos|resido|residimos|estoy viviendo|estoy en|escribo desde))\b/

function declaredBy(current: string, value: string, marker: RegExp): boolean {
  const source = fold(current)
  for (const match of source.matchAll(new RegExp(marker))) {
    const before = source.slice(0, match.index).trimEnd()
    const literalBefore = current.normalize('NFC').slice(0, match.index).trimEnd()
    // Accented affirmative «sí vivo» must not be treated as conditional «si vivo».
    if (/\b(?:no|ya no|ojala|cuando)\s*$/.test(before) || /\bsi\s*$/i.test(literalBefore)) continue
    const after = source.slice((match.index || 0) + match[0].length).split(otherDeclaration)[0]
      .split(/\b(?:no en|antes|anteriormente|vivia|residia|planeo|quiero vivir|visitando)\b|[;!?]|\.(?:\s|$)/)[0]
    if (contains(after, value)) return true
  }
  return false
}

const profilePending = (input: Row) => {
  const pending = object(input.pregunta_pendiente), profile = object(input.perfil_inicial)
  const missing = Array.isArray(profile.missing) ? profile.missing.map(text) : []
  const question = words(text(pending.question || pending.text)), id = text(pending.id)
  return { pending, profile,
    name: profile.awaiting === true && missing.includes('full_name') || ['lead_profile', 'lead_profile_name'].includes(id)
      || /\b(?:su nombre|que nombre|como (?:se llama|le (?:llamamos|llame)))\b/.test(question),
    residence: profile.awaiting === true && missing.some(key => ['residence_city', 'residence_country'].includes(key))
      || ['lead_profile', 'lead_profile_residence', 'lead_residence_confirmation'].includes(id)
      || /\b(?:vive|viven|reside|residen|residencia)\b/.test(question) }
}

/** The model proposes typed facts. Evidence validation preserves ambiguous places as candidates. */
export function normalizeLeadProfile(raw: Row, current: string, input: Row): Row {
  const { pending, profile, name: awaitsName, residence: awaitsResidence } = profilePending(input)
  const evidence = object(raw.profile_evidence), accepted: Row = { full_name: null, residence_city: null, residence_country: null }
  const values: Row = { full_name: null, residence_city: null, residence_country: null }
  const diagnostics: string[] = []
  const currentWords = words(current)
  const hasDisqualifier = /\b(?:soy de|somos de|naci|nacido|nacida|nacionalidad|origen|escribo desde|estoy en|de viaje|vacaciones|proyecto|edificio|vivia|residia|vivire|residire|quiero vivir|planeo vivir)\b/.test(currentWords)
  const hasResidence = /\b(?:vivo|vivimos|resido|residimos|viviendo|residencia|domicilio|radicad[oa])\b/.test(currentWords)
  const validValue = (value: unknown, quote: unknown) => !!label(value) && literal(text(quote), current) && contains(text(quote), label(value))
  const name = label(raw.full_name), nameQuote = text(evidence.full_name).trim()
  if (validValue(name, nameQuote) && !/\bno (?:me llamo|soy)\b/.test(words(nameQuote)) && !declaredBy(nameQuote, name, originMarker)
    && (awaitsName || /\b(?:me llamo|mi nombre es|soy|digame|llameme|puede llamarme)\b/.test(words(nameQuote)))) {
    values.full_name = name; accepted.full_name = nameQuote
  }
  for (const key of ['residence_city', 'residence_country']) {
    const value = label(raw[key]), quote = text(evidence[key]).trim()
    if (!validValue(value, quote)) continue
    const explicit = declaredBy(current, value, residenceMarker) && declaredBy(quote, value, residenceMarker)
    const shortAnswer = awaitsResidence && !hasDisqualifier && !hasResidence
      && !/\b(?:no|prefiero no|no quiero|no deseo|no voy a)\b/.test(currentWords)
    if (!explicit && !shortAnswer) continue
    values[key] = value; accepted[key] = quote
  }

  let declared: Row | null = null
  const proposed = object(raw.declared_location), kind = text(proposed.kind), quote = text(proposed.evidence).trim()
  if (['origin', 'temporary', 'unspecified'].includes(kind) && literal(quote, current)) {
    const location: Row = { city: null, country: null, kind, evidence: quote }
    for (const field of ['city', 'country']) {
      const value = label(proposed[field])
      if (!validValue(value, quote)) continue
      const supported = kind === 'origin' ? declaredBy(quote, value, originMarker)
        : kind === 'temporary' ? declaredBy(quote, value, temporaryMarker)
        : !hasDisqualifier && !hasResidence && awaitsResidence
      if (supported) location[field] = value
    }
    if (location.city || location.country) declared = location
  }
  // Compatibility with an older extractor returning origin in residence_city/country.
  if (!declared) {
    const location: Row = { city: null, country: null, kind: 'origin', evidence: null }
    for (const [key, field] of [['residence_city', 'city'], ['residence_country', 'country']]) {
      const value = label(raw[key]), quote = text(evidence[key]).trim()
      if (!validValue(value, quote) || !declaredBy(current, value, originMarker)) continue
      location[field] = value; location.evidence = quote
    }
    if (location.city || location.country) { declared = location; diagnostics.push('origin_preserved_as_declared_location') }
  }

  let confirmation: Row | null = null
  const candidate = object(profile.residence_candidate), target = object(pending.residence_candidate)
  const sameCandidate = !!(label(candidate.city) || label(candidate.country))
    && words(text(candidate.city)) === words(text(target.city)) && words(text(candidate.country)) === words(text(target.country))
  const proposedConfirmation = object(raw.residence_confirmation), decision = text(proposedConfirmation.decision)
  const confirmationQuote = text(proposedConfirmation.evidence).trim()
  const answer = object(object(raw.turn_semantics).answer_to_previous)
  const contradictsPendingAnswer = Object.keys(answer).length > 0 && (answer.question_id !== 'lead_residence_confirmation' || answer.kind === 'none')
  const declaredCandidateDiffers = declared && declared.kind !== 'temporary'
    && ((declared.city && words(text(declared.city)) !== words(text(candidate.city)))
      || (declared.country && words(text(declared.country)) !== words(text(candidate.country))))
  if (text(pending.id) === 'lead_residence_confirmation' && sameCandidate && ['confirm', 'deny'].includes(decision)
    && !contradictsPendingAnswer && !declaredCandidateDiffers
    && proposedConfirmation.confidence === 'high' && literal(confirmationQuote, current)) {
    // A confirmation belongs to this question and candidate, never to an unrelated yes in the turn.
    const fragment = words(confirmationQuote)
    const positive = /^(?:si\b|claro\b|correcto\b|exacto\b|asi es\b|afirmativo\b|confirmo\b)/.test(fragment)
      || /\b(?:ese|esa) es mi (?:residencia|domicilio)\b/.test(fragment)
    const negative = /^(?:no\b|negativo\b)/.test(fragment) || /\b(?:no vivo|no resido|no es mi residencia)\b/.test(fragment)
    if ((decision === 'confirm' && positive && !negative && !/\b(?:pero no|ya no|no vivo|no resido)\b/.test(currentWords))
      || (decision === 'deny' && negative)) confirmation = { decision, evidence: confirmationQuote, confidence: 'high' }
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
  } else if (/\b(?:prefiero no|no quiero|no deseo|no voy a)\b[^.!?]{0,80}\b(?:decir|indicar|compartir|dar|responder)\b/.test(currentWords)
    && awaitsResidence) {
    status = 'declined'; diagnostics.push('residence_collection_declined')
  } else if (declared && declared.kind !== 'temporary') {
    status = 'pending_confirmation'
    residenceCandidate = { city: declared.city, country: declared.country, evidence: declared.evidence }
    diagnostics.push('declared_location_needs_residence_confirmation')
  } else if (declared) diagnostics.push('temporary_location_not_residence')
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
  result.diagnostics = Array.isArray(incoming.diagnostics) ? incoming.diagnostics : []
  return result
}

export const LEAD_PROFILE_EXTRACTION_RULES = `
Separe lugar declarado y residencia ACTUAL. declared_location conserva ciudad/pais y evidence literal: kind=origin para "soy de", nacimiento u origen; temporary para "escribo desde", viaje o vacaciones; unspecified solo para un lugar cuyo papel es ambiguo. Nunca borre un origen por no ser residencia.
"Soy de Cuenca" conserva Cuenca como origen y candidato por confirmar; NO llena residence_city ni residence_country, ni siquiera después de preguntar residencia. "Soy de Cuenca pero vivo en Guayaquil" conserva Cuenca en declared_location y Guayaquil como residence_city con evidencia "vivo en Guayaquil". Si nombra explícitamente la residencia no necesita confirmar el origen.
Un país o una ciudad debe aparecer literalmente en su evidencia actual. No infiera país de ciudad, teléfono, nombre, proyecto ni historia. Lugares temporales, deseados, futuros, antiguos o negados no acreditan residencia. Nombre y perfil no eligen un inmueble ni autorizan una cita.
residence_confirmation solo puede responder pregunta_pendiente.id=lead_residence_confirmation y su residence_candidate, coincidente con perfil_inicial.residence_candidate. Para "sí" o "no" devuelva confirm/deny con evidence actual y confidence; no copie el lugar histórico como una declaración literal nueva. Una corrección explícita de residencia prevalece. Una aceptación de brochure, precio o cita no confirma residencia. Si no es una respuesta inequívoca a esa pregunta, devuelva null.
full_name es el nombre declarado con que desea ser llamado, no requiere apellidos. profile_evidence contiene evidencia literal actual para cada valor propuesto; no complete valores desde el historial ni invente un nombre del contacto de WhatsApp.
`
