import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { leadIntroductionIssues, leadIntroductionReviewIssues, leadIntroductionReviewSchema, leadIntroductionRepairs,
  leadIntroductionTurn, leadProfilePendingQuestion, rememberLeadIntroduction, PROFILE_INVITATION, type LeadIntroductionInput } from './lead-introduction'
import { BROCHURE_URL } from './project-material'

const catalog = [
  { id: 'a201', unit_number: '201', category: 'departamento', bedrooms: 2, price: 210000 },
  { id: 'a901', unit_number: '901', category: 'departamento', bedrooms: 3, price: 310000 },
  { id: 's305', unit_number: '305', category: 'suite', bedrooms: 1, price: 120000 },
]
const declaredName = (name: string, evidence = name) => ({ full_name: name, evidence: { full_name: evidence },
  sources: { full_name: { source: 'lead_declaration', evidence, message_id: 'declared-name' } } })
const input = (overrides: Partial<LeadIntroductionInput> = {}): LeadIntroductionInput => ({
  current: 'Quiero información', history: [], summary: {}, extracted: {}, catalog,
  reply: `La Vilet reúne suites, departamentos y locales. Aquí está el brochure: ${BROCHURE_URL}\n¿Le gustaría conocer alguna de estas opciones?`,
  audit: { source: 'project_overview' }, ...overrides,
})

describe('informational engagement limits proactive profile capture', () => {
  it('answers a current information request without capturing profile or consuming the previous receipt', () => {
    const previous = { status: 'pending', request_sent: true, reminder_count: 0, requested_fields: ['full_name', 'residence'] }
    const reply = 'Tenemos opciones de tres dormitorios.'
    const turn = leadIntroductionTurn(input({ current: 'No quiero comprar; sólo por curiosidad, ¿hay tres dormitorios?',
      summary: { _lead_introduction: previous }, reply, engagement: { passive: true, property_continuation_allowed: false },
      extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high' } }, audit: { source: 'catalog_search' } }))
    assert.equal(turn.reply, reply)
    assert.equal(turn.applied, false)
    assert.deepEqual(turn.state, previous)
    assert.deepEqual((turn.audit.profile_collection_decision as { allowed_fields: string[] }).allowed_fields, [])
    assert.equal((turn.audit.profile_collection_decision as { action: string }).action, 'defer')
  })

  it('acknowledges a volunteered name without reopening the residence reminder in informational mode', () => {
    const previous = { status: 'pending', request_sent: true, reminder_count: 0, requested_fields: ['full_name', 'residence'] }
    const turn = leadIntroductionTurn(input({ current: 'Soy Carlos; sólo estoy consultando los precios',
      summary: { _lead_introduction: previous }, engagement: { passive: true },
      extracted: { lead_profile: declaredName('Carlos', 'Soy Carlos') }, reply: 'Estos son los precios de las opciones.', audit: { source: 'unit_price' } }))
    assert.match(turn.reply, /Mucho gusto, Carlos/)
    assert.match(turn.reply, /Estos son los precios/)
    assert.doesNotMatch(turn.reply, /reside|su nombre|brochure/i)
    assert.deepEqual(turn.state, previous)
    assert.deepEqual((turn.audit.profile_collection_decision as { allowed_fields: string[] }).allowed_fields, [])
  })

  it('preserves the authorized one-time residence reminder for a normal name plus price answer', () => {
    const turn = leadIntroductionTurn(input({ current: 'Soy Carlos, ¿qué precios tienen?',
      summary: { _lead_introduction: { status: 'pending', request_sent: true, reminder_count: 0, requested_fields: ['full_name', 'residence'] } },
      engagement: { passive: false }, extracted: { lead_profile: declaredName('Carlos', 'Soy Carlos'),
        turn_semantics: { primary_intent: 'ask_price', confidence: 'high' } }, reply: 'Estos son los precios.', audit: { source: 'unit_price' } }))
    assert.match(turn.reply, /reside actualmente/)
    assert.equal((turn.audit.profile_introduction as { question_purpose: string }).question_purpose, 'collect_residence')
    assert.equal(turn.state.reminder_count, 1)
  })

  it('does not alter an explicitly requested operation or its required question', () => {
    const reply = 'Para coordinar la visita, ¿qué día y hora prefiere?'
    const turn = leadIntroductionTurn(input({ current: 'Quiero visitar la oficina', engagement: { passive: true },
      reply, audit: { source: 'visit_collecting', action: 'collecting' },
      extracted: { turn_semantics: { primary_intent: 'request_visit', confidence: 'high' } } }))
    assert.equal(turn.reply, reply)
    assert.equal(turn.audit.action, 'collecting')
    assert.deepEqual((turn.audit.profile_collection_decision as { allowed_fields: string[] }).allowed_fields, [])
  })

  it('preserves required financial collection after explicit consent without a separate profile invitation', () => {
    const reply = 'Para la revisión que solicitó, ¿cuál es su nombre legal completo?'
    const turn = leadIntroductionTurn(input({ current: 'Sí, quiero iniciar la revisión financiera', engagement: { passive: true },
      reply, audit: { source: 'financing_collection', financing_collection: { collection_allowed: true, requested_fields: ['full_name'] } },
      extracted: { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', confidence: 'high' } } }))
    assert.equal(turn.reply, reply)
    assert.equal(turn.audit.source, 'financing_collection')
    assert.deepEqual((turn.audit.financing_collection as { requested_fields: string[] }).requested_fields, ['full_name'])
    assert.deepEqual((turn.audit.profile_collection_decision as { allowed_fields: string[] }).allowed_fields, [])
  })
})

describe('commercial opening uses the existing grounded interpretation', () => {
  const semantics = { primary_intent: 'ask_financing', confidence: 'high' }
  it('does not require correctly spelled commercial keywords to ask name and residence', () => {
    const turn = leadIntroductionTurn(input({ current: 'tiene finaciamiento porque dispobngo de 100',
      extracted: { turn_semantics: semantics }, audit: { source: 'financing_question' },
      reply: 'Podemos explicar las alternativas disponibles.' }))
    assert.equal(turn.applied, true)
    assert.match(turn.reply, /su nombre.*reside actualmente/)
    assert.deepEqual((turn.audit.profile_introduction as { missing_fields: string[] }).missing_fields, ['full_name', 'residence'])
  })
  it('plans the first invitation from the interpreted request across catalogue operations and future routes', () => {
    for (const source of ['catalog_details', 'catalog_compare', 'catalog_rank', 'future_project_information']) {
      const turn = leadIntroductionTurn(input({ current: 'me interesa información de los apartamentos',
        history: [{ role: 'bot', content: 'Hola, ¿en qué podemos ayudarle?' }],
        extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high',
          property: { category: 'departamento', operation: 'details', confidence: 'high' } } },
        audit: { source }, reply: 'Hay dos alternativas. ¿Qué planta prefiere?' }))
      assert.equal(turn.applied, true, source)
      assert.ok(turn.reply.endsWith(PROFILE_INVITATION), source)
      assert.match(turn.reply, /departamentos de 2 y 3 dormitorios/, source)
      assert.doesNotMatch(turn.reply, /Qué planta|https:\/\//, source)
      assert.equal(turn.state.status, 'pending', source)
      assert.equal((turn.audit.profile_introduction as { question_purpose: string }).question_purpose, 'collect_profile', source)
    }
  })
  it('preserves a concrete detail or comparison answer before the missing-data question', () => {
    for (const source of ['catalog_details', 'catalog_compare', 'future_comparison_answer']) {
      const turn = leadIntroductionTurn(input({ current: '¿Qué diferencia hay entre 201 y 901?',
        extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high' } },
        audit: { source }, reply: 'El 201 tiene 2 dormitorios y el 901 tiene 3. ¿Qué planta prefiere?' }))
      assert.match(turn.reply, /201 tiene 2 dormitorios.*901 tiene 3/, source)
      assert.ok(turn.reply.endsWith(PROFILE_INVITATION), source)
      assert.doesNotMatch(turn.reply, /Qué planta|https:\/\//, source)
    }
  })
  it('uses grounded extracted requests when their primary intent is other', () => {
    const turn = leadIntroductionTurn(input({ current: 'y eso cómo funciona?',
      extracted: { turn_semantics: { primary_intent: 'other', confidence: 'high' },
        requests: [{ domain: 'property', request: 'Explicar el concepto del proyecto', evidence: 'eso cómo funciona', confidence: 'high' }] },
      audit: { source: 'future_concept_answer' }, reply: 'El proyecto reúne las opciones del catálogo.' }))
    assert.equal(turn.applied, true)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
  })
  it('does not treat informative reservation metadata or a catalogue operation as an executed action', () => {
    for (const overrides of [
      { current: '¿Cómo funciona la reserva?', extracted: { turn_semantics: { primary_intent: 'ask_reservation', confidence: 'high' } },
        audit: { source: 'reservation_information', action: 'information_only', reservation: { kind: 'information', handoff_verified: false } } },
      { current: '¿Qué incluye el 201?', extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high', property: { operation: 'details' } } },
        audit: { source: 'future_catalogue_handler', action: 'details', reservation: {} } },
    ]) {
      const turn = leadIntroductionTurn(input({ reply: 'Primero podemos revisar la opción que le interese.', ...overrides }))
      assert.equal(turn.applied, true)
      assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
    }
  })
  it('does not restart a declined or ignored invitation when the catalogue route changes', () => {
    for (const previous of [
      { status: 'complete', request_sent: true, collection_status: 'deferred' },
      { status: 'skipped', request_sent: true, collection_status: 'declined' },
    ]) {
      const reply = 'El departamento tiene 2 dormitorios.'
      const turn = leadIntroductionTurn(input({ current: '¿Qué incluye el 201?', reply,
        summary: { _lead_introduction: previous }, audit: { source: 'catalog_details' },
        extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high' } } }))
      assert.equal(turn.reply, reply)
      assert.equal(turn.applied, false)
    }
  })
  it('protects semantic operations and uncertain or foreign scope even on a new route', () => {
    const reply = '¿Para qué día le gustaría coordinarla?'
    for (const overrides of [
      { extracted: { turn_semantics: { primary_intent: 'request_visit', confidence: 'high' } } },
      { extracted: { turn_semantics: { primary_intent: 'request_reservation', confidence: 'high' } } },
      { extracted: { requested_advisor: true } },
      { audit: { source: 'future_route', business_scope: 'out_of_scope' } },
      { audit: { source: 'future_route', resolved_turn_intent: { scope: { kind: 'property', uncertain: true } } } },
    ]) {
      const turn = leadIntroductionTurn(input({ current: 'Quiero información', reply, audit: { source: 'future_route' }, ...overrides }))
      assert.equal(turn.reply, reply)
      assert.equal(turn.applied, false)
    }
  })
  it('respects a prior delivered invitation and protected financing steps', () => {
    const invited = { status: 'complete', requested_fields: ['full_name', 'residence'], collection_status: 'deferred' }
    const base = 'Podemos explicar las alternativas disponibles.'
    const next = leadIntroductionTurn(input({ current: 'y qué datos se necesitan?', reply: base,
      summary: { _lead_introduction: invited }, extracted: { turn_semantics: semantics }, audit: { source: 'financing_question' } }))
    assert.equal(next.reply, base)
    for (const source of ['financing', 'reservation_handoff', 'visit_intake']) {
      const turn = leadIntroductionTurn(input({ current: 'sí, continuemos', reply: base,
        extracted: { turn_semantics: semantics }, audit: { source, state: 'cedula_pendiente' } }))
      assert.equal(turn.reply, base, source)
      assert.equal(turn.applied, false, source)
    }
    const selecting = leadIntroductionTurn(input({ current: 'sí, continuemos', reply: base,
      extracted: { turn_semantics: semantics }, audit: { source: 'financing_selection_required' } }))
    assert.equal(selecting.applied, true, 'An unasked introduction precedes selecting a unit for financing.')
    assert.ok(selecting.reply.endsWith(PROFILE_INVITATION))
  })
})

describe('semantic opening stage review', () => {
  const audit = { profile_introduction: { generic_introduction: true } }
  const references = [
    { id: 'S1', text: 'La Vilet está ubicada en Puertas del Sol, Cuenca.' },
    { id: 'S2', text: 'Cuenta con unidades residenciales modernas y espacios comerciales.' },
    { id: 'S3', text: 'Para enviarle el brochure y brindarle una guía personalizada, ¿cuál es su nombre y dónde reside actualmente?' },
  ]

  it('requires an explicit decision limited to IDs of this draft when the opening stage is active', () => {
    const schema = leadIntroductionReviewSchema(audit, references)
    assert.deepEqual(schema.required, ['opening_property_type_sentence_ids'])
    const field = schema.properties.opening_property_type_sentence_ids as { items: { enum: string[] }; maxItems: number }
    assert.deepEqual(field.items.enum, ['S1', 'S2', 'S3'])
    assert.equal(field.maxItems, 3)
  })

  it('makes the reviewer category finding binding even if the general operational check says true', () => {
    const review = { operational_goal_preserved: true, opening_property_type_sentence_ids: ['S2'] }
    const issues = leadIntroductionReviewIssues(review, audit, references)
    assert.equal(issues.length, 1)
    assert.equal(issues[0].kind, 'commercial_content')
    assert.equal(issues[0].code, 'lead_profile_categories_premature')
    assert.equal(issues[0].sentence_id, 'S2')
    assert.equal(issues[0].fragment, references[1].text)
    assert.equal(issues[0].owner, 'reviewer')
    assert.equal(issues[0].validation_owner, 'system')
    assert.equal(issues[0].repair_owner, 'writer')
    // No growing synonym list: the reviewer supplies the semantic finding.
    assert.deepEqual(leadIntroductionIssues(references.map(row => row.text).join(' '), audit), [])
  })

  it('accepts a clean opening when the reviewer explicitly finds no premature property types', () => {
    assert.deepEqual(leadIntroductionReviewIssues({ opening_property_type_sentence_ids: [] }, audit,
      references.filter(row => row.id !== 'S2')), [])
  })

  it('repairs a missing or invalid reviewer decision as metadata without accusing the prose', () => {
    for (const review of [{}, { opening_property_type_sentence_ids: 'S2' },
      { opening_property_type_sentence_ids: ['S99'] }, { opening_property_type_sentence_ids: [null] }]) {
      const issues = leadIntroductionReviewIssues(review, audit, references)
      assert.equal(issues.length, 1)
      assert.equal(issues[0].kind, 'review_metadata')
      assert.equal(issues[0].code, 'invalid_opening_stage_review')
      assert.equal(issues[0].repair_owner, 'reviewer')
      assert.match(String(issues[0].instruction), /No reescriba el mensaje/)
    }
  })

  it('does not restrict category-specific answers or the continuation after collecting profile data', () => {
    for (const otherAudit of [{}, { profile_introduction: { generic_introduction: false, stage: 'deliver' } }]) {
      assert.deepEqual(leadIntroductionReviewSchema(otherAudit, references), { properties: {}, required: [] })
      assert.deepEqual(leadIntroductionReviewIssues({ opening_property_type_sentence_ids: ['S2'] }, otherAudit, references), [])
      assert.deepEqual(leadIntroductionReviewIssues({}, otherAudit, references), [])
    }
  })

  it('repair instructions remove the premature meaning rather than substitute property category names', () => {
    const [repair] = leadIntroductionRepairs(['lead_profile_categories_premature'], audit)
    assert.equal(repair.target, 'commercial_draft')
    assert.match(String(repair.instruction), /No basta con cambiar/)
    assert.match(String(repair.instruction), /tipos de inmuebles/)
    assert.match(String(repair.instruction), /conserve la pregunta de los datos pendientes/)
  })
})
const begin = () => {
  const turn = leadIntroductionTurn(input())
  return { ...turn, state: rememberLeadIntroduction({ previous: {}, planned: turn.state, profile: {}, reply: turn.reply,
    audit: { ...turn.audit, turn_completeness: { status: 'checked' } }, accepted: true, followUpUsable: true }) }
}
const pending = (overrides: Partial<LeadIntroductionInput> = {}) => input({
  current: 'Me llamo Juan', summary: { _lead_introduction: begin().state },
  extracted: { lead_profile: declaredName('Juan', 'Me llamo Juan') },
  reply: '¿Qué planta prefiere?', audit: { source: 'catalog_search' }, ...overrides,
})

const originProfile = (name = 'Carlos', city = 'Cuenca') => ({ ...declaredName(name),
  declared_location: { city, country: null, kind: 'origin', evidence: `soy de ${city}` },
  residence_candidate: { city, country: null, evidence: `soy de ${city}` }, residence_status: 'pending_confirmation' })

describe('progressive lead introduction', () => {
  it('keeps requesting the name when a CRM label has no declaration provenance', () => {
    for (const profile of [{ full_name: 'Carlos Fabian' },
      { full_name: 'Carlos Fabian', sources: { full_name: { source: 'crm', evidence: 'Carlos Fabian' } } }]) {
      const turn = leadIntroductionTurn(input({ summary: { _lead_profile: profile } }))
      assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
      assert.doesNotMatch(turn.reply, /Carlos/)
      assert.equal(turn.state.status, 'pending')
      assert.equal((turn.audit.profile_introduction as { question_purpose: string }).question_purpose, 'collect_profile')
    }
  })
  it('reuses a prior declared name without asking it again or repeating its acknowledgement', () => {
    const known = declaredName('Ana María', 'Me llamo Ana María')
    const turn = leadIntroductionTurn(input({ summary: { _lead_profile: known } }))
    assert.match(turn.reply, /Mucho gusto, Ana/)
    assert.match(turn.reply, /reside actualmente/)
    assert.doesNotMatch(turn.reply, /indicarnos su nombre/)
    const next = leadIntroductionTurn(input({ current: 'Vivo en Chile',
      summary: { _lead_profile: known, _lead_introduction: { ...turn.state, acknowledged_name: 'Ana' } },
      extracted: { lead_profile: { residence_country: 'Chile' } } }))
    assert.doesNotMatch(next.reply, /Mucho gusto|indicarnos su nombre|reside actualmente/)
    assert.equal(next.state.status, 'complete')
  })
  it('keeps bare greetings short and asks name and residence on the following project inquiry', () => {
    const reply = 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?'
    for (const current of ['Hola', 'Buenos días', 'Buenas tardes', 'Hola, ¿cómo está?']) {
      const greeting = leadIntroductionTurn(input({ current, reply, audit: { source: 'minimal_greeting' },
        extracted: { turn_semantics: { primary_intent: 'project_information', confidence: 'high' } } }))
      assert.equal(greeting.applied, false, current)
      assert.equal(greeting.reply, reply)
      assert.equal(greeting.audit.source, 'minimal_greeting')
      assert.deepEqual(greeting.state, {})
      assert.doesNotMatch(greeting.reply, /brochure|reside|nombre|La Vilet/)
    }
    const turn = leadIntroductionTurn(input({ history: [
      { role: 'cliente', content: 'Hola' },
      { role: 'bot', content: 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?' },
    ] }))
    assert.equal(turn.applied, true)
    assert.match(turn.reply, /Puertas del Sol, Cuenca/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
    assert.doesNotMatch(turn.reply, /suite|departamento|penthouse|locales|https:\/\//i)
    assert.equal((turn.reply.match(/\?/g) || []).length, 1)
    assert.equal(turn.state.status, 'pending')
  })
  it('a greeting does not consume the pending profile reminder or mark the brochure sent', () => {
    const state = { status: 'pending', request_sent: true, reminder_count: 0, brochure_sent: false }
    const reply = 'Hola, ¿en qué podemos ayudarle?'
    const result = leadIntroductionTurn(input({ current: 'Hola', reply, audit: { source: 'minimal_greeting' },
      summary: { _lead_introduction: state } }))
    assert.equal(result.applied, false)
    assert.equal(result.reply, reply)
    assert.deepEqual(result.state, state)
  })
  it('answers category interest briefly using the entire verified category catalog', () => {
    const turn = leadIntroductionTurn(input({ current: 'Hola, me interesan los departamentos',
      extracted: { preferred_category: 'departamento' }, audit: { source: 'catalog_search' },
      reply: 'Departamento 201 de 2 dormitorios. Departamento 901 de 3 dormitorios. ¿Qué planta prefiere?' }))
    assert.match(turn.reply, /departamentos de 2 y 3 dormitorios/)
    assert.doesNotMatch(turn.reply, /201|901|planta/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
  })
  it('does not substitute an unrelated category summary for an actual price answer', () => {
    const turn = leadIntroductionTurn(input({ current: '¿Qué precio tienen los departamentos de 3 dormitorios?',
      extracted: { preferred_category: 'departamento', preferred_bedrooms: 3 },
      reply: 'Los departamentos de 3 dormitorios tienen precios referenciales desde $310.000; pueden cambiar. ¿Qué planta prefiere?',
      audit: { source: 'unit_price' } }))
    assert.match(turn.reply, /\$310\.000/)
    assert.match(turn.reply, /pueden cambiar/)
    assert.doesNotMatch(turn.reply, /Qué planta/)
    assert.ok(turn.reply.endsWith(PROFILE_INVITATION))
  })
  it('gives the brochure and resumes category-specific continuity when both facts arrive', () => {
    const first = leadIntroductionTurn(input({ current: 'Me interesan los departamentos',
      extracted: { preferred_category: 'departamento' }, audit: { source: 'catalog_search' } }))
    const turn = leadIntroductionTurn(pending({ current: 'Soy Carlos y vivo en Madrid',
      summary: { _lead_introduction: first.state },
      extracted: { lead_profile: { ...declaredName('Carlos', 'Soy Carlos'), residence_city: 'Madrid' } } }))
    assert.match(turn.reply, /brochure/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.match(turn.reply, /Cuántos dormitorios está buscando/)
    assert.doesNotMatch(turn.reply, /su nombre|reside|suite|local|Qué planta/)
    assert.equal(turn.state.status, 'complete')
  })
  it('asks only the missing residence after receiving a name, with one reminder maximum', () => {
    const turn = leadIntroductionTurn(pending())
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.match(turn.reply, /guía personalizada.*en qué ciudad o país reside actualmente/)
    assert.doesNotMatch(turn.reply, /su nombre|desde dónde|desde qué/)
    assert.equal(turn.state.reminder_count, 1)
    const following = leadIntroductionTurn(pending({ current: 'Vivo en Cuenca',
      summary: { _lead_introduction: turn.state, _lead_profile: declaredName('Juan', 'Me llamo Juan') },
      extracted: { lead_profile: { full_name: null, residence_city: 'Cuenca' } } }))
    assert.equal(following.state.status, 'complete')
    assert.doesNotMatch(following.reply, /https:\/\/|su nombre|reside actualmente/)
    assert.match(following.reply, /suites, departamentos, penthouses y locales comerciales/)
    assert.match(following.reply, /información de alguna de estas opciones/)
  })
  it('accepts country-only residence and asks only the missing name', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Vivo en Estados Unidos',
      extracted: { lead_profile: { residence_country: 'Estados Unidos' } } }))
    assert.match(turn.reply, /podría indicarnos su nombre/)
    assert.doesNotMatch(turn.reply, /reside actualmente/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
  })
  it('answers an ignored-profile price question and releases the brochure without another profile demand', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Pero dígame el precio de los de 3 dormitorios',
      extracted: { preferred_category: 'departamento', preferred_bedrooms: 3 },
      audit: { source: 'unit_price' },
      reply: 'Los departamentos de 3 dormitorios cuestan desde $310.000. Estos precios son referenciales.' }))
    assert.match(turn.reply, /3 dormitorios.*\$310\.000/)
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(turn.reply, /su nombre|reside|suites|Qué planta/)
    assert.equal(turn.state.status, 'complete')
  })
  it('respects profile refusal without blocking the brochure or continuing to collect', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Prefiero no dar mis datos', extracted: {} }))
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(turn.reply, /podría indicarnos|su nombre|reside/)
    assert.equal(turn.state.status, 'complete')
  })
  it('never holds an explicitly requested brochure', () => {
    const turn = leadIntroductionTurn(input({ current: 'Envíeme el brochure', audit: { source: 'brochure' },
      reply: `Aquí tiene el brochure: ${BROCHURE_URL}` }))
    assert.ok(turn.reply.includes(BROCHURE_URL))
    assert.equal(turn.brochureDeferred, false)
    assert.equal(turn.state.status, 'complete')
  })
  it('does not restart a delivered request or interrupt an operational request', () => {
    for (const override of [
      { audit: { source: 'visit_intake' }, current: 'Quiero una cita para mañana' },
      { audit: { source: 'financing' }, current: 'Quiero que revisen el crédito' },
      { summary: { _lead_introduction: { ...begin().state, status: 'complete' } } },
    ]) assert.equal(leadIntroductionTurn(input(override)).applied, false)
  })
  it('keeps verified category facts without copying promotional claims from the desired wording', () => {
    const turn = leadIntroductionTurn(input())
    assert.doesNotMatch(turn.reply, /mayor plusvalía|terrazas privadas|iluminación natural|vanguardista/)
    const known = leadIntroductionTurn(input({ profile: { ...declaredName('Ana', 'Soy Ana'), residence_country: 'Chile' } }))
    assert.ok(known.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(known.reply, /podría indicarnos/)
  })
  it('keeps stage and material guards while leaving question meaning to independent review', () => {
    const turn = begin()
    assert.deepEqual(leadIntroductionIssues(turn.reply, turn.audit), [])
    assert.deepEqual(leadIntroductionIssues(turn.reply.replace('reside actualmente', 'nos escribe'), turn.audit), [])
    assert.ok(leadIntroductionIssues('La Vilet está en Cuenca.', turn.audit).includes('lead_profile_question_missing'))
    assert.ok(leadIntroductionIssues(turn.reply + ' Tenemos departamentos.', turn.audit).includes('lead_profile_categories_premature'))
    assert.ok(leadIntroductionIssues(turn.reply + BROCHURE_URL, turn.audit).includes('lead_profile_brochure_premature'))
    const delivered = leadIntroductionTurn(pending())
    assert.deepEqual(leadIntroductionIssues(delivered.reply, delivered.audit), [])
    assert.ok(leadIntroductionIssues(delivered.reply.replace(BROCHURE_URL, ''), delivered.audit).includes('lead_profile_brochure_missing'))
  })

  it('keeps any declared place as a candidate and confirms it instead of asking from scratch', () => {
    for (const [name, city] of [['Carlos', 'Cuenca'], ['Ana', 'Loja'], ['Lucía', 'Buenos Aires']]) {
      const turn = leadIntroductionTurn(pending({ current: `claro, ${name} y soy de ${city}`,
        extracted: { lead_profile: originProfile(name, city) } }))
      assert.match(turn.reply, new RegExp(`Mucho gusto, ${name}\\.`))
      assert.ok(!turn.reply.includes(BROCHURE_URL))
      assert.equal(turn.brochureDeferred, true)
      assert.equal(turn.state.brochure_sent, false)
      assert.ok(turn.reply.includes(`Entiendo que es de ${city}. ¿Es también su lugar de residencia actual?`))
      assert.doesNotMatch(turn.reply, /en qué ciudad|su nombre|Qué planta/)
      assert.deepEqual(leadIntroductionIssues(turn.reply, turn.audit), [])
      const question = leadProfilePendingQuestion(turn.reply, turn.audit)
      assert.equal(question.id, 'lead_residence_confirmation')
      assert.equal((question.residence_candidate as { city: string }).city, city)
    }
  })

  it('confirms a supplied place on the first substantive message and when it arrives later', () => {
    for (const summary of [{}, { _lead_introduction: { status: 'complete', brochure_sent: true } }]) {
      const turn = leadIntroductionTurn(input({ current: 'Soy Ana y soy de Loja, me interesan los departamentos', summary,
        extracted: { lead_profile: originProfile('Ana', 'Loja'), preferred_category: 'departamento' },
        reply: 'Tenemos departamentos de 2 y 3 dormitorios. ¿Qué planta prefiere?', audit: { source: 'catalog_search' } }))
      assert.match(turn.reply, /departamentos de 2 y 3 dormitorios/)
      assert.match(turn.reply, /Mucho gusto, Ana/)
      assert.match(turn.reply, /Entiendo que es de Loja.*residencia actual/s)
      assert.doesNotMatch(turn.reply, /Qué planta|en qué ciudad/)
      assert.equal((turn.reply.match(/\?/g) || []).length, 1)
    }
  })

  it('does not repeat a name acknowledgement or question a confirmed residence despite retained origin', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Sí, vivo en Guayaquil',
      summary: { _lead_introduction: { ...begin().state, acknowledged_name: 'Carlos', brochure_sent: true }, _lead_profile: originProfile() },
      extracted: { lead_profile: { residence_city: 'Guayaquil', residence_status: 'confirmed' } } }))
    assert.doesNotMatch(turn.reply, /Mucho gusto|Cuenca|residencia actual|reside actualmente|https:/)
    assert.equal(turn.state.status, 'complete')
    assert.match(turn.reply, /información de alguna de estas opciones/)
  })

  it('accepts confirmation paraphrases with the same purpose and rejects a false assertion', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Carlos, soy de Cuenca', extracted: { lead_profile: originProfile() } }))
    const reply = 'Mucho gusto, Carlos. Entiendo que es de Cuenca. ¿Actualmente vive allí?'
    assert.deepEqual(leadIntroductionIssues(reply, turn.audit), [])
    assert.equal(leadProfilePendingQuestion(reply, turn.audit).question, '¿Actualmente vive allí?')
    assert.ok(leadIntroductionIssues(reply.replace('Entiendo que es de', 'Como vive en'), turn.audit).includes('lead_profile_unconfirmed_residence'))
    assert.deepEqual(leadIntroductionIssues(reply.replace('¿Actualmente vive allí?', '¿En qué ciudad reside actualmente?'), turn.audit), [])
    assert.ok(leadIntroductionIssues(reply.replace('Mucho gusto, Carlos.', ''), turn.audit).includes('lead_profile_name_acknowledgement_missing'))
    // Semantic review, not a location substring check, must reject a changed candidate.
    assert.deepEqual(leadIntroductionIssues(reply.replace('Cuenca', 'Quito'), turn.audit), [])
  })

  it('retains a parallel budget answer and first-name acknowledgement on specialized routes', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Soy Carlos, soy de Cuenca y mi presupuesto es 70 mil',
      extracted: { lead_profile: originProfile(), turn_semantics: { primary_intent: 'discuss_budget', confidence: 'high' } },
      reply: 'Podemos revisar las opciones disponibles según su presupuesto. ¿Qué tipo de vivienda le interesa?', audit: { source: 'property_budget_deferred' } }))
    assert.match(turn.reply, /revisar las opciones disponibles según su presupuesto/)
    assert.match(turn.reply, /Entiendo que es de Cuenca/)
    assert.equal((turn.reply.match(/\?/g) || []).length, 1)
    const specialized = leadIntroductionTurn(pending({ current: 'Me llamo Carlos, quiero una visita',
      extracted: { lead_profile: declaredName('Carlos', 'Me llamo Carlos') }, audit: { source: 'visit_intake' }, reply: '¿Qué día desea visitarnos?' }))
    assert.equal(specialized.reply, 'Mucho gusto, Carlos.\n\n¿Qué día desea visitarnos?')
  })

  it('does not repeatedly confirm a candidate after an evasive response or demand refused data', () => {
    const turn = leadIntroductionTurn(pending({ current: 'Carlos, soy de Cuenca', extracted: { lead_profile: originProfile() } }))
    for (const current of ['Prefiero no dar mis datos', '¿Qué precio tienen las suites?']) {
      const next = leadIntroductionTurn(pending({ current, summary: { _lead_introduction: turn.state, _lead_profile: originProfile() },
        extracted: {}, reply: 'Las suites tienen precios referenciales desde $100.000.', audit: { source: 'unit_price' } }))
      assert.doesNotMatch(next.reply, /residencia|reside|soy de|Entiendo que es/)
      assert.ok(next.reply.includes(BROCHURE_URL), 'A skipped clarification must not hold the material indefinitely.')
    }
  })

  it('defers the promised brochure through an actual confirmation and releases it after the answer is accepted', () => {
    const profile = originProfile('Nathaly')
    const turn = leadIntroductionTurn(pending({ current: 'Nathaly\nSoy de Cuenca', extracted: { lead_profile: profile } }))
    const plan = turn.audit.profile_introduction as { brochure_deferred: boolean; brochure_required: boolean }
    assert.equal(plan.brochure_deferred, true)
    assert.equal(plan.brochure_required, false)
    assert.ok(!turn.reply.includes(BROCHURE_URL))
    for (const semantic_review_enabled of [false, true]) {
      assert.deepEqual(leadIntroductionIssues(turn.reply, { ...turn.audit, semantic_review_enabled }), [])
      assert.ok(leadIntroductionIssues(`${turn.reply}\n${BROCHURE_URL}`, { ...turn.audit, semantic_review_enabled })
        .includes('lead_profile_brochure_premature'))
    }
    const remembered = rememberLeadIntroduction({ previous: begin().state, planned: turn.state, profile,
      reply: turn.reply, audit: { ...turn.audit, turn_completeness: { status: 'checked' } }, accepted: true, followUpUsable: true })
    assert.equal(remembered.brochure_sent, false)
    assert.equal(remembered.confirmation_asked, true)
    assert.equal(leadProfilePendingQuestion(turn.reply, turn.audit).id, 'lead_residence_confirmation')
    const accepted = leadIntroductionTurn(pending({ current: 'Sí',
      summary: { _lead_introduction: remembered, _lead_profile: profile },
      extracted: { lead_profile: { residence_city: 'Cuenca', residence_status: 'confirmed',
        residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' } } } }))
    assert.ok(accepted.reply.includes(BROCHURE_URL))
    assert.equal(accepted.brochureDeferred, false)
    assert.equal(accepted.state.brochure_sent, true)
    assert.equal(accepted.state.status, 'complete')
    assert.doesNotMatch(accepted.reply, /residencia actual|reside actualmente|Mucho gusto/)
    assert.equal((accepted.reply.split(BROCHURE_URL).length - 1), 1)
  })

  it('does not condition an already delivered or explicitly requested brochure on residence clarification', () => {
    const profile = originProfile('Nathaly')
    const previouslyShared = leadIntroductionTurn(pending({ current: 'Nathaly, soy de Cuenca',
      summary: { _lead_introduction: { ...begin().state, brochure_sent: true } },
      extracted: { lead_profile: profile } }))
    assert.equal(previouslyShared.brochureDeferred, false)
    assert.ok(!previouslyShared.reply.includes(BROCHURE_URL))
    assert.match(previouslyShared.reply, /residencia actual/)
    assert.doesNotMatch(previouslyShared.reply, /Para enviarle|Así podré enviarle/)
    const requested = leadIntroductionTurn(pending({ current: 'Soy Nathaly, soy de Cuenca, envíeme el brochure',
      extracted: { lead_profile: profile }, audit: { source: 'brochure' } }))
    assert.equal(requested.brochureDeferred, false)
    assert.ok(requested.reply.includes(BROCHURE_URL))
    assert.doesNotMatch(requested.reply, /Para enviarle|Así podré enviarle/)
    assert.deepEqual(leadIntroductionIssues(requested.reply, requested.audit), [])
  })
})

describe('profile collection across delivered conversation turns', () => {
  const history = [
    { role: 'cliente', content: 'Hola quiero informacion sobre vehiculos' },
    { role: 'bot', content: 'Solo puedo ofrecer información sobre el proyecto inmobiliario La Vilet.' },
  ]
  const commit = (turn: ReturnType<typeof leadIntroductionTurn>, previous = {}, profile = {}, reply = turn.reply,
    options: { accepted?: boolean; followUpUsable?: boolean; recovery?: boolean; reviewStatus?: string } = {}) => rememberLeadIntroduction({
    previous, planned: turn.state, profile, reply, accepted: options.accepted ?? true,
    followUpUsable: options.followUpUsable ?? true, recovery: options.recovery,
    audit: { ...turn.audit, semantic_review_enabled: true, turn_completeness: { status: options.reviewStatus || 'checked' } },
  })

  it('requests profile after the recorded outside exchange, answers price without repeating, then asks only missing residence', () => {
    const first = leadIntroductionTurn(input({ history,
      current: 'disuculpe me equivoque de numero, si esta bien ayudame con informacion del prpyecto inmobiliario' }))
    assert.equal(first.applied, true)
    assert.deepEqual((first.audit.profile_introduction as { missing_fields: string[] }).missing_fields, ['full_name', 'residence'])
    const invited = commit(first)
    assert.deepEqual(invited.requested_fields, ['full_name', 'residence'])
    assert.equal(invited.collection_status, 'awaiting')
    const price = leadIntroductionTurn(input({ history, current: 'interesante y que precio tiene?',
      summary: { _lead_introduction: invited }, extracted: { turn_semantics: { primary_intent: 'ask_price', confidence: 'high' } },
      audit: { source: 'unit_price' }, reply: 'Los precios referenciales van desde $145.000 hasta $550.000 y pueden cambiar.' }))
    assert.match(price.reply, /145\.000.*550\.000/)
    assert.doesNotMatch(price.reply, /su nombre|reside actualmente/)
    const deferred = commit(price, invited)
    assert.equal(deferred.collection_status, 'deferred')
    assert.deepEqual(deferred.missing_fields, ['full_name', 'residence'])
    assert.equal(leadIntroductionTurn(input({ summary: { _lead_introduction: deferred } })).applied, false)
    const profile = declaredName('Carlos', 'Me llamo Carlos')
    const name = leadIntroductionTurn(input({ current: 'Me llamo Carlos', summary: { _lead_introduction: deferred },
      extracted: { lead_profile: profile }, audit: { source: 'commercial' } }))
    assert.match(name.reply, /reside actualmente/)
    assert.doesNotMatch(name.reply, /indicarnos su nombre/)
    const partial = commit(name, deferred, profile)
    assert.deepEqual(partial.missing_fields, ['residence'])
    assert.equal(partial.reminder_count, 1)
    const ignored = leadIntroductionTurn(input({ current: 'Me llamo Carlos',
      summary: { _lead_introduction: partial, _lead_profile: profile }, extracted: { lead_profile: profile } }))
    assert.doesNotMatch(ignored.reply, /reside actualmente/)
    const completedProfile = { ...profile, residence_country: 'Ecuador' }
    const residence = leadIntroductionTurn(input({ current: 'Vivo en Ecuador', summary: { _lead_introduction: partial, _lead_profile: profile },
      extracted: { lead_profile: { residence_country: 'Ecuador' } } }))
    assert.equal(commit(residence, partial, completedProfile).collection_status, 'complete')
  })

  it('existing chat and delivered material do not stand in for a profile request', () => {
    for (const summary of [{}, { _lead_introduction: { status: 'complete', brochure_sent: true } }]) {
      const turn = leadIntroductionTurn(input({ summary, history }))
      assert.equal(turn.applied, true)
      assert.match(turn.reply, /su nombre.*reside actualmente/)
    }
    const material = leadIntroductionTurn(input({ current: 'Envíeme el brochure', audit: { source: 'brochure' } }))
    const state = commit(material)
    assert.equal(state.collection_status, 'not_requested')
    assert.equal(state.brochure_sent, true)
    const next = leadIntroductionTurn(input({ summary: { _lead_introduction: state }, history }))
    assert.match(next.reply, /Con el brochure que le compartimos/)
    assert.match(next.reply, /su nombre.*reside actualmente/)
  })

  it('does not count rejected, unsent, omitted, or recovery questions as requests', () => {
    const turn = leadIntroductionTurn(input({ history }))
    for (const options of [{ accepted: false }, { followUpUsable: false }, { recovery: true }, { reviewStatus: 'rejected_review' }]) {
      assert.deepEqual(commit(turn, {}, {}, turn.reply, options), {})
    }
    const omitted = commit(turn, {}, {}, 'La Vilet está en Cuenca.')
    assert.deepEqual(omitted.requested_fields, [])
    assert.equal(omitted.collection_status, 'not_requested')
    assert.notEqual(omitted.status, 'pending')
    assert.equal(leadIntroductionTurn(input({ history, summary: { _lead_introduction: omitted } })).applied, true)
    const natural = commit(turn, {}, {}, 'Para compartirle el brochure y orientarle, ¿cómo se llama y dónde vive actualmente?')
    assert.equal(natural.collection_status, 'awaiting')
  })

  it('respects refusal across later requests and accepts spontaneous partial data', () => {
    const invited = begin().state
    const refusal = leadIntroductionTurn(input({ current: 'Prefiero no dar mis datos', summary: { _lead_introduction: invited } }))
    const state = commit(refusal, invited)
    assert.equal(state.collection_status, 'declined')
    const next = leadIntroductionTurn(input({ summary: { _lead_introduction: state }, history }))
    assert.equal(next.applied, false)
    for (const profile of [declaredName('Ana', 'Soy Ana'), { residence_country: 'Chile' }]) {
      const turn = leadIntroductionTurn(input({ current: 'Quiero información', extracted: { lead_profile: profile }, history }))
      const plan = turn.audit.profile_introduction as { missing_fields: string[] }
      assert.deepEqual(plan.missing_fields, 'full_name' in profile ? ['residence'] : ['full_name'])
      assert.equal((turn.reply.match(/\?/g) || []).length, 1)
      assert.doesNotMatch(turn.reply, /dirección domiciliaria|calle|teléfono/)
    }
  })
})
