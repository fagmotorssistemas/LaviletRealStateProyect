import { object, text, type Row } from './data'
import { projectQuantityEvidence } from './project-quantities'
import { numericMentions } from './semantic-review'
import { BROCHURE_URL } from './project-material'
import { confirmedLeadProfile } from './lead-profile'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const fields = ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'floor_number', 'published_commercial_price']

/** One immutable, scoped source for writer, reviewer and deterministic checks. */
export function turnEvidence(verified: Row, audit: Row = {}, currentQuoteUnits: Row[] = []) {
  const sources = audit.verified_catalog === true
    ? [{ source: 'query', units: rows(object(audit.catalog_results).units) },
      { source: 'alternatives', units: rows(object(audit.alternative_results).units) }]
    : [{ source: 'context', units: rows(verified.catalogo) }]
  const byId = new Map<string, Row>()
  const conflicts: Row[] = []
  for (const { source, units } of sources) for (const unit of units) {
    const id = text(unit.id)
    if (!id) continue
    const previous = byId.get(id)
    if (previous && fields.some(field => previous[field] != null && unit[field] != null && previous[field] !== unit[field])) {
      conflicts.push({ code: 'conflicting_evidence', unit_id: id, kind: 'system_evidence' }); continue
    }
    byId.set(id, { ...previous, ...unit, evidence_sources: [...new Set([...(Array.isArray(previous?.evidence_sources) ? previous.evidence_sources : []), source])] })
  }
  const units = [...byId.values()]
  const groups: Row[] = []
  const addGroup = (key: string, members: Row[], metadata: Row) => {
    if (!members.length) return
    const endpoints: Record<string, Row> = {}
    for (const aggregation of ['min', 'max'] as const) {
      const values: Row = {}
      for (const field of fields) if (members.every(unit => unit[field] != null && unit[field] !== '' && Number.isFinite(Number(unit[field]))))
        values[field] = Math[aggregation](...members.map(unit => Number(unit[field])))
      endpoints[aggregation] = values
      groups.push({ id: `group:${key}:${aggregation}`, ...metadata, aggregation,
        member_ids: members.map(unit => unit.id), ...values })
    }
    groups.push({ id: `group:${key}:range`, ...metadata, aggregation: 'range', member_ids: members.map(unit => unit.id),
      ...endpoints.min, upper_values: endpoints.max })
  }
  for (const key of new Set(units.map(unit => `${text(unit.category)}:${unit.bedrooms ?? 'unknown'}`))) {
    const members = units.filter(unit => `${text(unit.category)}:${unit.bedrooms ?? 'unknown'}` === key)
    addGroup(key, members, { category: members[0].category, bedrooms_filter: members[0].bedrooms ?? null })
  }
  // A general price range cannot be attributed to one unit or to a fabricated
  // "price" identifier. Give the reviewer code-owned references for exact sets.
  for (const { source, units: sourceUnits } of sources) {
    const ids = new Set(sourceUnits.map(unit => text(unit.id)))
    addGroup(`${source}:all`, units.filter(unit => ids.has(text(unit.id))), { source_scope: source, category: null })
  }
  for (const category of new Set(units.map(unit => text(unit.category)).filter(Boolean))) {
    addGroup(`${category}:all`, units.filter(unit => text(unit.category) === category), { category, bedrooms_filter: null })
  }
  // Supplied only by this turn's freshly recomputed authorized price quote, not
  // by reviewer metadata or a remembered quote. Unpriced and unavailable units
  // elsewhere in the catalogue must not erase these valid scoped endpoints.
  const quoted = units.filter(unit => currentQuoteUnits.some(quoted => quoted.id === unit.id
    && Number.isFinite(Number(quoted.published_commercial_price))
    && quoted.published_commercial_price != null && quoted.published_commercial_price !== ''
    && Number(quoted.published_commercial_price) === Number(unit.published_commercial_price)))
  const priceScope = { source_scope: 'current_price_quote', covers: 'quoted_available_units_with_published_price' }
  addGroup('price_quote:all', quoted, { ...priceScope, category: null })
  for (const category of new Set(quoted.map(unit => text(unit.category)).filter(Boolean))) {
    addGroup(`price_quote:${category}:all`, quoted.filter(unit => text(unit.category) === category), { ...priceScope, category })
  }
  return { version: 'turn-evidence-v3', units, groups, conflicts, project_facts: projectQuantityEvidence(verified),
    query: audit.catalog_query || null, query_result_ids: object(audit.catalog_results).unit_ids || [],
    alternative_query: object(audit.alternative_results).query || null,
    alternative_ids: object(audit.alternative_results).unit_ids || [] }
}

export function replyReferences(reply: string) {
  return reply.split(/(?<=[.!?])\s+|\n+/).map(value => value.trim()).filter(Boolean)
    .map((value, index) => ({ id: `S${index + 1}`, text: value }))
}

/** Code-owned provenance. Drafts, base copy, remembered messages and model
 * interpretations are deliberately not eligible project/operational sources. */
export function verifiedClaimSources(verified: Row, audit: Row, evidence: Row, current = ''): Row[] {
  const result: Row[] = []
  const add = (path: string, kind: string, value: unknown, extra: Row = {}) => {
    if (value == null || value === '' || Array.isArray(value) && !value.length
      || typeof value === 'object' && !Array.isArray(value) && !Object.keys(object(value)).length) return
    result.push({ id: `E${result.length + 1}`, kind, path, value, ...extra })
  }
  // References to the one canonical catalogue avoid copying all its fields into
  // the prompt twice. The IDs identify existing sources, never model prose.
  for (const key of ['units', 'groups'] as const) rows(evidence[key]).forEach((unit, index) => {
    result.push({ id: `E${result.length + 1}`, kind: 'project_fact', path: `evidencia_turno.${key}.${index}`,
      reference_id: unit.id, reference_label: unit.unit_number || unit.category || null })
  })
  const projectKeys = ['proyecto', 'alcance_producto', 'instalaciones', 'lugares_cercanos', 'contexto_sector', 'estado_proyecto',
    'posicionamiento_proyecto', 'politica_comercial', 'politica_visitas', 'politica_financiera', 'financing_policy', 'financiamiento',
    'condiciones_instalaciones', 'horario_atencion', 'ubicacion']
  for (const key of projectKeys) {
    const value = verified[key]
    if (Array.isArray(value)) value.forEach((item, index) => add(`contexto_verificado.${key}.${index}`, 'project_fact', item))
    else add(`contexto_verificado.${key}`, 'project_fact', value)
  }
  // Being able to share a configured material is a project fact, not proof that
  // it was already delivered in WhatsApp or that a reservation was performed.
  const profile = object(audit.profile_introduction), tour = object(audit.unit_model)
  add('materiales_configurados.brochure', 'project_fact', {
    kind: 'brochure', url: text(profile.brochure_url) || text(verified.brochure_url) || BROCHURE_URL,
  })
  if (text(tour.url)) add('estado_operativo.unit_model', 'project_fact', {
    kind: 'tour_360', unit_number: tour.unit_number || null, unit_id: tour.unit_id || null, url: tour.url,
  })
  const query = object(audit.catalog_query), queryResults = object(audit.catalog_results)
  if (audit.verified_catalog === true && query.scope === 'catalog' && queryResults.complete === true
    && Array.isArray(queryResults.units) && !queryResults.units.length
    && Array.isArray(queryResults.unknown_unit_ids) && !queryResults.unknown_unit_ids.length)
    add('catalog_evidence.catalog_results', 'project_fact', { query, complete: true, units: [] }, { scope: 'catalog_no_results' })
  for (const key of ['reservation', 'visit_result', 'visit_draft', 'visit', 'handoff_result', 'advisor_assignment', 'action_result'])
    add(`estado_operativo.${key}`, 'operational_fact', audit[key])
  if (typeof audit.action === 'string' || typeof audit.registration_verified === 'boolean')
    add('estado_operativo.resultado_accion', 'operational_fact', Object.fromEntries(
      ['source', 'action', 'registration_verified', 'request_id', 'assigned_advisor_id', 'preference', 'selected_option', 'selected_partner']
        .filter(key => audit[key] != null).map(key => [key, audit[key]])))
  add('contexto_verificado.propuestas', 'operational_fact', rows(verified.propuestas).filter(proposal =>
    ['awaiting_advisor', 'awaiting_client', 'confirmed', 'cancelled', 'rejected'].includes(text(proposal.status))))
  add('contexto_verificado.avisos_operativos_confirmados', 'operational_fact', verified.avisos_operativos_confirmados)
  // A declaration can support acknowledgement, never a property fact or action.
  add('mensaje_actual', 'lead_statement', current)
  const leadProfile = confirmedLeadProfile(verified.perfil_lead || profile.profile_state)
  add('contexto_verificado.perfil_lead', 'lead_statement', leadProfile)
  // Contact/CRM labels cannot certify a client's identity, including when a
  // historical context accidentally still supplies lead.name.
  const leadFacts = Object.fromEntries(Object.entries(object(verified.lead)).filter(([key]) =>
    !['name', 'full_name', 'display_name', 'contact_name', 'name_source', 'name_confirmed'].includes(key)))
  add('contexto_verificado.lead', 'lead_statement', leadFacts)
  return result
}

/** Resolve only references that identify one sentence of the actual draft. Never change a value. */
export function normalizeReviewReferences(review: Row, units: Row[], reply: string) {
  const corrections: Row[] = []
  const sentences = replyReferences(reply)
  const resolveFragment = (item: Row): Row => {
    let sentence = sentences.find(sentence => sentence.id === item.fragment)
    if (!sentence && /\.{3}|…/.test(text(item.fragment))) {
      const parts = text(item.fragment).split(/\.{3}|…/).map(part => part.trim()).filter(Boolean)
      if (parts.length >= 2 && parts.every(part => part.length >= 4)) {
        const matches = sentences.filter(candidate => {
          let offset = 0
          return parts.every(part => {
            const index = candidate.text.indexOf(part, offset)
            if (index < 0) return false
            offset = index + part.length
            return true
          })
        })
        if (matches.length === 1) {
          sentence = matches[0]
          corrections.push({ code: 'abbreviated_sentence_reference_resolved', from: text(item.fragment), to: sentence.id })
        }
      }
    }
    // The reviewer may paraphrase the prose. A unique occurrence of the exact
    // numeric value in the draft is a code-owned reference, independent of word order.
    const fragmentNumbers = numericMentions(text(item.fragment)).map(match => match.value)
    if (!sentence && !reply.includes(text(item.fragment)) && typeof item.value === 'number' && Number.isFinite(item.value)
      && (!fragmentNumbers.length || fragmentNumbers.includes(item.value))) {
      const includesValue = (candidate: string, value: number) => numericMentions(candidate).some(match => match.value === value)
      const matches = sentences.filter(candidate => fragmentNumbers.every(value => includesValue(candidate.text, value))
        && includesValue(candidate.text, item.value as number)
        && (item.operator !== 'between' || typeof item.upper_value === 'number'
          && includesValue(candidate.text, item.upper_value)))
      if (matches.length === 1) {
        sentence = matches[0]
        corrections.push({ code: 'unique_numeric_sentence_reference_resolved', from: text(item.fragment), to: sentence.id })
      }
    }
    if (sentence && sentence.id === item.fragment) corrections.push({ code: 'sentence_reference_resolved', from: sentence.id })
    return sentence ? { ...item, fragment: sentence.text } : { ...item }
  }
  const facts = Array.isArray(review.factual_values) ? review.factual_values.map(raw => {
    const fact = resolveFragment(object(raw))
    if (!units.some(unit => unit.id === fact.unit_id)) {
      const matches = units.filter(unit => unit.unit_number != null && text(unit.unit_number) === text(fact.unit_id))
      if (matches.length === 1) {
        corrections.push({ code: 'unit_number_resolved', from: fact.unit_id, to: matches[0].id })
        fact.unit_id = matches[0].id
      }
    }
    return fact
  }) : review.factual_values
  return { review: { ...review, factual_values: facts,
    claims: Array.isArray(review.claims) ? review.claims.map(raw => resolveFragment(object(raw))) : review.claims }, corrections }
}
