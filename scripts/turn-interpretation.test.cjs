/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { interpretConversationTurn, rememberInterpretedTurn, TURN_EXTRACTION_SCHEMA, CONVERSATION_CONTRACT_VERSION } = require('../src/lib/integrations/automation/turn-interpretation.ts')
const { TURN_SEMANTICS_SCHEMA } = require('../src/lib/integrations/automation/turn-semantics.ts')
const { unreadMediaMarker } = require('../src/lib/integrations/automation/media-format.ts')
const { mergeLeadProfile } = require('../src/lib/integrations/automation/lead-profile.ts')

test('the entire extraction schema is closed recursively, including nullable objects and semantics', () => {
  function check(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false)
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
      Object.values(schema.properties).forEach(check)
    }
    if (schema.items) check(schema.items)
    if (schema.anyOf) schema.anyOf.forEach(check)
  }
  check(TURN_EXTRACTION_SCHEMA)
  assert.equal(TURN_EXTRACTION_SCHEMA.properties.turn_semantics, TURN_SEMANTICS_SCHEMA)
  assert.ok(TURN_EXTRACTION_SCHEMA.required.includes('requests'))
})

test('pure greetings and unreadable-only media never call prompts or inherit operational events', async () => {
  const forbidden = async () => { throw Error('UNEXPECTED_DEPENDENCY_CALL') }
  const dependencies = { activePrompt: forbidden, aiJson: forbidden }
  for (const [current, method] of [['Hola', 'literal_greeting'], ['[Sticker recibido]', 'unreadable_input'], [unreadMediaMarker({ type: 'audio' }), 'unreadable_input']]) {
    const result = await interpretConversationTurn({ mensaje_actual: current, resumen: { requested_visit: true, opt_out: true }, historial: [{ role: 'cliente', content: 'quiero visitar mañana' }] }, dependencies)
    assert.equal(result.method, method)
    assert.deepEqual(result.extracted.events, [])
    assert.equal(result.extracted.opt_out, false)
    assert.equal(result.extracted.requested_advisor, false)
    assert.deepEqual(result.requests, [])
    assert.equal(result.promptRevision, null)
  }
})

test('readable text accompanying a failed attachment is interpreted once with a strict contract', async () => {
  const current = 'Quiero la opcion de la 5ta planta'
  const calls = []
  const dependencies = {
    activePrompt: async name => { calls.push({ name }); return 'Extraiga eventos del turno actual.' },
    aiJson: async (instructions, input, schema) => {
      calls.push({ instructions, input, schema })
      return { events: [], requests: [{ request: 'opciones de la quinta planta', evidence: current, confidence: 'high' }], turn_semantics: {
        primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
        property: { category: 'departamento', reference_kind: 'explicit', unit_numbers: ['502'], evidence: current, confidence: 'high' },
      } }
    },
  }
  const result = await interpretConversationTurn({ mensaje_actual: `${current}\n${unreadMediaMarker({ type: 'audio' })}`, pregunta_pendiente: { id: 'property_floor', question: '¿Qué planta prefiere?' } }, dependencies)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].name, 'extractor_eventos')
  assert.equal(calls[1].input.mensaje_actual, current)
  assert.equal(calls[1].schema, TURN_EXTRACTION_SCHEMA)
  assert.match(calls[1].instructions, /lavilet-dialogue-v3/)
  assert.equal(result.semantics.property.filters.floor_number, 5)
  assert.equal(result.semantics.property.operation, 'search')
  assert.equal(result.diagnostic.filters.floor_number, 5)
  assert.equal(result.diagnostic.contract_version, CONVERSATION_CONTRACT_VERSION)
  assert.match(result.promptRevision, /^[a-f0-9]{16}$/)
})

test('only requests evidenced in this turn survive and telemetry omits identity and financial fields', async () => {
  const current = 'Me interesa vivienda y quiero saber si admiten mascotas'
  const raw = {
    monthly_income: 3210, national_id: '0102030405', full_name: 'Nombre privado',
    requests: [
      { request: 'opciones residenciales', evidence: 'Me interesa vivienda', confidence: 'high' },
      { request: 'política de mascotas', evidence: 'si admiten mascotas', confidence: 'high' },
      { request: 'agendar visita histórica', evidence: 'quiero ir mañana a las diez', confidence: 'high' },
      { request: 'evidencia ausente', evidence: '', confidence: 'high' },
    ],
    turn_semantics: { primary_intent: 'select_property', primary_evidence: 'Me interesa vivienda', confidence: 'high',
      property: { category: 'departamento', operation: 'select', evidence: 'Me interesa vivienda', confidence: 'high' } },
  }
  const result = await interpretConversationTurn({ mensaje_actual: current, historial: [{ role: 'cliente', content: 'quiero ir mañana a las diez' }] }, {
    activePrompt: async () => 'Prompt', aiJson: async () => raw,
  })
  assert.equal(result.requests.length, 2)
  assert.equal(result.diagnostic.discarded_request_count, 2)
  assert.equal(result.semantics.property.group, 'residential')
  assert.equal(result.semantics.property.category, null)
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /0102030405|3210|Nombre privado/)
})

test('prompt revision changes with instructions and durable continuity needs no extra model call', async () => {
  const input = { mensaje_actual: 'Necesito información del proyecto' }
  const run = prompt => interpretConversationTurn(input, { activePrompt: async () => prompt, aiJson: async () => ({}) })
  const first = await run('Versión uno'), same = await run('Versión uno'), changed = await run('Versión dos')
  assert.equal(first.promptRevision, same.promptRevision)
  assert.notEqual(first.promptRevision, changed.promptRevision)
  const previous = { datos_confirmados: { presupuesto: 'no definido' }, _property_context: { version: 2, selected_ids: ['u502'] } }
  const memory = rememberInterpretedTurn(previous, 'Para invertir', { purchase_purpose: 'invertir' })
  assert.equal(memory.datos_confirmados.proposito, 'invertir')
  assert.equal(memory.datos_confirmados.presupuesto, 'no definido')
  assert.deepEqual(memory._property_context, previous._property_context)
  assert.equal(memory._turn_contract, CONVERSATION_CONTRACT_VERSION)
})

test('stale advisor, opt-out and follow-up flags cannot turn an ordinary request into an action', async () => {
  for (const current of ['Quiero el brochure', 'Quiero saber el precio', 'Tengo una moto para vender y pagar la entrada']) {
    const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt',
      aiJson: async () => ({ requested_advisor: true, opt_out: true, consent_granted: true,
        action_evidence: { requested_advisor: 'quiero un asesor', opt_out: 'no me escriban', consent_granted: 'acepto recibir novedades' } }) })
    assert.equal(result.extracted.requested_advisor, false, current)
    assert.equal(result.extracted.opt_out, false, current)
    assert.equal(result.extracted.tracking_consent, false, current)
  }
})

test('literal action evidence and explicit legacy requests preserve authorized actions', async () => {
  const run = (current, raw) => interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt', aiJson: async () => raw })
  assert.equal((await run('Quiero hablar con una persona', {})).extracted.requested_advisor, true)
  assert.equal((await run('No quiero hablar con un asesor', { requested_advisor: true })).extracted.requested_advisor, false)
  assert.equal((await run('No me escriban más', {})).extracted.opt_out, true)
  assert.equal((await run('Acepto recibir novedades', {})).extracted.tracking_consent, true)
  const current = 'Me gustaría que alguien del equipo atienda mi caso'
  assert.equal((await run(current, { requested_advisor: true, action_evidence: { requested_advisor: current } })).extracted.requested_advisor, true)
})

test('request domains keep a visit acceptance separate from additional property and financing questions', async () => {
  const current = 'Sí, confirmo la cita. ¿Admiten mascotas? ¿Tienen financiamiento?'
  const requests = [
    { request: 'confirmar la visita', domain: 'visit', evidence: 'Sí, confirmo la cita', confidence: 'high' },
    { request: 'política de mascotas', domain: 'property', evidence: '¿Admiten mascotas?', confidence: 'high' },
    { request: 'opciones de financiamiento', domain: 'financing', evidence: '¿Tienen financiamiento?', confidence: 'high' },
  ]
  const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt', aiJson: async (_rules, _input, schema) => {
    assert.deepEqual(schema.properties.requests.items.properties.domain.enum, ['property', 'visit', 'financing', 'advisor', 'tracking', 'courtesy', 'other'])
    assert.ok(schema.properties.requests.items.required.includes('domain'))
    return { requests }
  } })
  assert.deepEqual(result.requests, requests)
  assert.equal(result.requests.filter(request => request.domain !== 'visit').length, 2)
})

test('missing and invalid legacy request domains become other, never a fabricated visit', async () => {
  const current = 'Sí, de acuerdo'
  const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt', aiJson: async () => ({ requests: [
    { request: 'aceptación antigua sin dominio', evidence: current, confidence: 'high' },
    { request: 'etiqueta inválida', domain: 'appointment', evidence: current, confidence: 'high' },
    { request: 'dominio normalizado', domain: ' PROPERTY ', evidence: current, confidence: 'high' },
  ] }) })
  assert.deepEqual(result.requests.map(request => request.domain), ['other', 'other', 'property'])
  const empty = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt', aiJson: async () => ({ requests: [] }) })
  assert.deepEqual(empty.requests, [])
})

test('thanks after confirming a visit remain courtesy without a new commercial request', async () => {
  const current = 'Confirmo la cita, muchas gracias'
  const result = await interpretConversationTurn({ mensaje_actual: current }, { activePrompt: async () => 'Prompt', aiJson: async () => ({ requests: [
    { request: 'confirmar visita', domain: 'visit', evidence: 'Confirmo la cita', confidence: 'high' },
    { request: 'agradecimiento', domain: ' COURTESY ', evidence: 'muchas gracias', confidence: 'high' },
  ] }) })
  assert.deepEqual(result.requests.map(request => request.domain), ['visit', 'courtesy'])
  assert.equal(result.requests.filter(request => !['visit', 'tracking', 'courtesy'].includes(request.domain)).length, 0)
})

test('mixed scope limits advisor evidence to the property fragment while opt-out remains global', async () => {
  const outside = 'Quiero hablar con una persona para revisar mi vuelo'
  const property = 'También quiero conocer el precio del departamento 502'
  const current = `${outside}. ${property}. No me escriban más`
  const result = await interpretConversationTurn({ mensaje_actual: current, mensaje_accion: property }, { activePrompt: async () => 'Prompt', aiJson: async () => ({
    requested_advisor: true, opt_out: true, consent_granted: true,
    action_evidence: { requested_advisor: outside, opt_out: 'No me escriban más', consent_granted: outside },
    requests: [{ request: 'asesor para revisar vuelo', domain: 'other', evidence: outside, confidence: 'high' },
      { request: 'precio del departamento', domain: 'property', evidence: property, confidence: 'high' },
      { request: 'baja de mensajes', domain: 'tracking', evidence: 'No me escriban más', confidence: 'high' }],
  }) })
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.opt_out, true)
  assert.equal(result.extracted.tracking_consent, false)
  assert.deepEqual(result.requests.map(request => request.domain), ['other', 'property', 'tracking'])
})

test('profile extraction separates residence from origin and never infers a country from a city', async () => {
  const current = 'Soy Carlos, soy de Loja pero vivo en Madrid'
  const run = raw => interpretConversationTurn({ mensaje_actual: current }, {
    activePrompt: async () => 'Prompt', aiJson: async () => raw,
  })
  const result = await run({ full_name: 'Carlos', residence_city: 'Madrid', residence_country: 'España',
    profile_evidence: { full_name: 'Soy Carlos', residence_city: 'vivo en Madrid', residence_country: 'vivo en Madrid' } })
  assert.equal(result.extracted.lead_profile.full_name, 'Carlos')
  assert.deepEqual(result.extracted.lead_profile.evidence, { full_name: 'Soy Carlos', residence_city: 'vivo en Madrid', residence_country: null })
  assert.equal(result.extracted.lead_profile.residence_status, 'confirmed')
  assert.equal(result.extracted.residence_city, 'Madrid')
  assert.equal(result.extracted.residence_country, null)
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /Carlos|Madrid|España/)
  const mistakenOrigin = await run({ residence_city: 'Loja', profile_evidence: { residence_city: current } })
  assert.equal(mistakenOrigin.extracted.residence_city, null)
})

const profileTurn = (current, raw, input = {}) => interpretConversationTurn({ mensaje_actual: current, ...input }, {
  activePrompt: async () => 'Prompt', aiJson: async () => raw,
})
const confirmationInput = (city = 'Cuenca', country = null) => ({
  perfil_inicial: { residence_status: 'pending_confirmation', residence_candidate: { city, country, evidence: `Soy de ${city || country}` } },
  pregunta_pendiente: { id: 'lead_residence_confirmation', residence_candidate: { city, country, evidence: `Soy de ${city || country}` } },
})
const metadata = { message_id: 'm2', declared_at: '2026-09-28T15:00:00Z' }

test('origin is retained for contextual confirmation instead of being lost or accepted as residence', async () => {
  for (const city of ['Cuenca', 'São Paulo', 'Łódź', '北京']) {
    const current = `Claro, Carlos y soy de ${city}`
    const result = await profileTurn(current, { full_name: 'Carlos', residence_city: city,
      profile_evidence: { full_name: current, residence_city: `soy de ${city}` } }, {
      perfil_inicial: { awaiting: true, missing: ['full_name', 'residence_city', 'residence_country'] },
      pregunta_pendiente: { id: 'lead_profile' },
    })
    const profile = result.extracted.lead_profile
    assert.equal(profile.full_name, 'Carlos')
    assert.equal(profile.residence_city, null)
    assert.equal(profile.declared_location.city, city)
    assert.equal(profile.declared_location.kind, 'origin')
    assert.equal(profile.residence_candidate.city, city)
    assert.equal(profile.residence_status, 'pending_confirmation')
  }
})

test('explicit current residence wins while an independently declared origin is retained', async () => {
  const current = 'Soy de Cuenca pero vivo en Guayaquil'
  const result = await profileTurn(current, { residence_city: 'Guayaquil', profile_evidence: { residence_city: 'vivo en Guayaquil' },
    declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'Soy de Cuenca' } }, confirmationInput())
  const profile = mergeLeadProfile(confirmationInput().perfil_inicial, result.extracted.lead_profile, metadata)
  assert.equal(profile.residence_city, 'Guayaquil')
  assert.equal(profile.residence_status, 'confirmed')
  assert.equal(profile.residence_candidate, null)
  assert.equal(profile.declared_location.city, 'Cuenca')
  assert.equal(profile.sources.residence_city.evidence, 'vivo en Guayaquil')
})

test('temporary places are preserved without becoming residence candidates', async () => {
  const current = 'Estoy en Madrid de vacaciones'
  const result = await profileTurn(current, { residence_city: 'Madrid', profile_evidence: { residence_city: current },
    declared_location: { city: 'Madrid', country: null, kind: 'temporary', evidence: current } }, {
    pregunta_pendiente: { id: 'lead_profile_residence' },
  })
  assert.equal(result.extracted.lead_profile.declared_location.city, 'Madrid')
  assert.equal(result.extracted.lead_profile.residence_candidate, null)
  assert.equal(result.extracted.residence_city, null)
})

test('positive and negative answers resolve only the specific pending candidate', async () => {
  const yes = await profileTurn('Sí, así es', { residence_confirmation: { decision: 'confirm', evidence: 'Sí, así es', confidence: 'high' } }, confirmationInput())
  assert.equal(yes.extracted.residence_city, 'Cuenca')
  assert.equal(yes.extracted.residence_country, null)
  const accepted = mergeLeadProfile(confirmationInput().perfil_inicial, yes.extracted.lead_profile, metadata)
  assert.equal(accepted.residence_status, 'confirmed')
  assert.equal(accepted.sources.residence_city.source, 'lead_confirmation')
  assert.equal(accepted.sources.residence_city.evidence, 'Sí, así es')
  const no = await profileTurn('No', { residence_confirmation: { decision: 'deny', evidence: 'No', confidence: 'high' } }, confirmationInput())
  const denied = mergeLeadProfile(confirmationInput().perfil_inicial, no.extracted.lead_profile, metadata)
  assert.equal(denied.residence_status, 'unknown')
  assert.equal(denied.residence_candidate, null)
  assert.equal(denied.rejected_residence_candidate.city, 'Cuenca')
})

test('a residence correction overrides a yes prefix or denial and cannot retain stale country', async () => {
  const current = 'Sí, soy de Cuenca, pero vivo en Guayaquil'
  const result = await profileTurn(current, { residence_city: 'Guayaquil', profile_evidence: { residence_city: 'vivo en Guayaquil' },
    residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' } }, confirmationInput())
  assert.equal(result.extracted.residence_city, 'Guayaquil')
  const changed = mergeLeadProfile({ residence_city: 'Madrid', residence_country: 'España', residence_status: 'confirmed' }, result.extracted.lead_profile, metadata)
  assert.equal(changed.residence_city, 'Guayaquil')
  assert.equal(changed.residence_country, undefined)
  assert.equal(changed.residence_candidate, null)
})

test('confirmation cannot be invented from history, medium confidence, a different question or mismatched target', async () => {
  for (const input of [
    {},
    { ...confirmationInput(), pregunta_pendiente: { id: 'visit_permission', residence_candidate: { city: 'Cuenca', country: null } } },
    { ...confirmationInput(), pregunta_pendiente: { id: 'lead_residence_confirmation', residence_candidate: { city: 'Loja', country: null } } },
  ]) {
    const result = await profileTurn('Sí', { residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' } }, input)
    assert.equal(result.extracted.residence_city, null)
  }
  for (const [current, evidence, confidence] of [['Quiero el precio', 'Sí', 'high'], ['Sí', 'Sí', 'medium'], ['Sí, pero no vivo ahí', 'Sí', 'high']]) {
    const result = await profileTurn(current, { residence_confirmation: { decision: 'confirm', evidence, confidence } }, confirmationInput())
    assert.equal(result.extracted.residence_city, null)
  }
})

test('pending origin survives unrelated turns and does not replace an already confirmed residence', async () => {
  const pending = confirmationInput().perfil_inicial
  const unrelated = (await profileTurn('¿Qué precio tienen?', {})).extracted.lead_profile
  assert.equal(mergeLeadProfile(pending, unrelated, metadata).residence_candidate.city, 'Cuenca')
  const origin = (await profileTurn('Soy de Cuenca', { declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'Soy de Cuenca' } })).extracted.lead_profile
  const merged = mergeLeadProfile({ residence_city: 'Madrid', residence_status: 'confirmed' }, origin, metadata)
  assert.equal(merged.residence_city, 'Madrid')
  assert.equal(merged.residence_status, 'confirmed')
  assert.equal(merged.declared_location.city, 'Cuenca')
  assert.equal(merged.residence_candidate, undefined)
})

test('geographic declarations require typed current evidence and do not accept project facts or old homes', async () => {
  for (const [current, value, kind] of [
    ['El proyecto está en Cuenca', 'Cuenca', 'origin'],
    ['Soy de Cuenca, pero vivo en Guayaquil', 'Guayaquil', 'origin'],
    ['Quiero el precio', 'Madrid', 'origin'],
  ]) {
    const result = await profileTurn(current, { declared_location: { city: value, country: null, kind, evidence: current } })
    assert.equal(result.extracted.lead_profile.declared_location, null)
  }
  for (const [current, value] of [['Vivo en Quito, no en Madrid', 'Madrid'], ['Vivo en Quito. Antes vivía en Madrid', 'Madrid'], ['Si vivo en Madrid el precio cambia?', 'Madrid']]) {
    const result = await profileTurn(current, { residence_city: value, profile_evidence: { residence_city: current } })
    assert.equal(result.extracted.residence_city, null)
  }
})

test('profile names and places support accents and non-Latin labels without inventing countries', async () => {
  for (const [name, city] of [['José María', 'São Paulo'], ['李明', '北京'], ['Zoë', 'Łódź']]) {
    const current = `Me llamo ${name} y vivo en ${city}`
    const result = await profileTurn(current, { full_name: name, residence_city: city,
      profile_evidence: { full_name: `Me llamo ${name}`, residence_city: `vivo en ${city}` } })
    assert.equal(result.extracted.lead_profile.full_name, name)
    assert.equal(result.extracted.residence_city, city)
    assert.equal(result.extracted.residence_country, null)
  }
})

test('declining residence collection does not discard known name or fabricate a location', async () => {
  const result = await profileTurn('Prefiero no compartir dónde vivo', {}, { pregunta_pendiente: { id: 'lead_profile_residence' } })
  const merged = mergeLeadProfile({ full_name: 'Carlos', ...confirmationInput().perfil_inicial }, result.extracted.lead_profile, metadata)
  assert.equal(merged.residence_status, 'declined')
  assert.equal(merged.full_name, 'Carlos')
  assert.equal(merged.residence_candidate, null)
})

test('affirmative sí residence declarations survive while conditional si stays unconfirmed', async () => {
  for (const current of ['Sí vivo en Quito', 'Sí, vivo en Quito']) {
    const result = await profileTurn(current, { residence_city: 'Quito', profile_evidence: { residence_city: current } })
    assert.equal(result.extracted.residence_city, 'Quito')
  }
  const origin = await profileTurn('Sí soy de Cuenca', { declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'Sí soy de Cuenca' } })
  assert.equal(origin.extracted.lead_profile.residence_candidate.city, 'Cuenca')
  const conditional = await profileTurn('Si vivo en Quito, ¿puedo visitar?', { residence_city: 'Quito', profile_evidence: { residence_city: 'vivo en Quito' } })
  assert.equal(conditional.extracted.residence_city, null)
})

test('confirmed explicit residence records declaration provenance even when a yes prefix was extracted', async () => {
  const current = 'Claro, Carlos y soy de Cuenca pero vivo en Guayaquil'
  const result = await profileTurn(current, { full_name: 'Carlos', residence_city: 'Guayaquil',
    profile_evidence: { full_name: current, residence_city: 'vivo en Guayaquil' },
    declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'soy de Cuenca' },
    residence_confirmation: { decision: 'confirm', evidence: 'Claro', confidence: 'high' } }, {
    ...confirmationInput(), perfil_inicial: { ...confirmationInput().perfil_inicial, awaiting: true, missing: ['full_name'] },
  })
  const merged = mergeLeadProfile({}, result.extracted.lead_profile, metadata)
  assert.equal(merged.full_name, 'Carlos')
  assert.equal(merged.residence_city, 'Guayaquil')
  assert.equal(merged.declared_location.city, 'Cuenca')
  assert.equal(merged.sources.residence_city.source, 'lead_declaration')
  assert.equal(merged.sources.residence_city.evidence, 'vivo en Guayaquil')
})

test('unrelated answer semantics cannot confirm residence and a changed origin changes the candidate', async () => {
  const wrongAnswer = await profileTurn('Sí, envíeme el brochure', {
    residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' },
    turn_semantics: { answer_to_previous: { question_id: 'none', kind: 'none', confidence: 'low' } },
  }, confirmationInput())
  assert.equal(wrongAnswer.extracted.residence_city, null)
  const changed = await profileTurn('Sí, soy de Loja', {
    residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' },
    declared_location: { city: 'Loja', country: null, kind: 'origin', evidence: 'soy de Loja' },
  }, confirmationInput())
  assert.equal(changed.extracted.residence_city, null)
  assert.equal(changed.extracted.lead_profile.residence_candidate.city, 'Loja')
})

test('pure profile planning keeps saved evidence timestamps and only-country confirmations do not infer cities', async () => {
  const input = confirmationInput(null, 'Ecuador')
  const result = await profileTurn('Sí', { residence_confirmation: { decision: 'confirm', evidence: 'Sí', confidence: 'high' } }, input)
  const stored = mergeLeadProfile(input.perfil_inicial, result.extracted.lead_profile, metadata)
  const planned = mergeLeadProfile(stored, result.extracted.lead_profile)
  assert.equal(planned.residence_city, undefined)
  assert.equal(planned.residence_country, 'Ecuador')
  assert.equal(planned.residence_status, 'confirmed')
  assert.deepEqual(planned.sources.residence_country, stored.sources.residence_country)
  assert.equal(planned.residence_confirmation.message_id, 'm2')
  const unrelated = (await profileTurn('¿Cuál es el precio?', {}, { perfil_inicial: { ...planned, awaiting: true, missing: ['residence_city'] } })).extracted.lead_profile
  const continued = mergeLeadProfile(planned, unrelated, { message_id: 'm3' })
  assert.equal(continued.residence_status, 'confirmed')
  assert.equal(continued.residence_country, 'Ecuador')
  assert.equal(continued.residence_city, undefined)
})

test('short profile answers need the pending question and retain existing financing name data', async () => {
  const run = (current, raw, input = {}) => interpretConversationTurn({ mensaje_actual: current, ...input }, {
    activePrompt: async () => 'Prompt', aiJson: async () => raw,
  })
  const raw = { residence_city: 'Cuenca', profile_evidence: { residence_city: 'Cuenca' } }
  assert.equal((await run('Cuenca', raw)).extracted.residence_city, null)
  const residence = await run('Cuenca', raw, { perfil_inicial: { awaiting: true, missing: ['residence_city', 'residence_country'] } })
  assert.equal(residence.extracted.residence_city, 'Cuenca')
  assert.equal(residence.extracted.residence_country, null)
  const name = await run('Juan', { full_name: 'Juan', profile_evidence: { full_name: 'Juan' } }, {
    pregunta_pendiente: { id: 'lead_profile_name', question: '¿Con qué nombre tengo el gusto?' },
  })
  assert.equal(name.extracted.lead_profile.full_name, 'Juan')
  assert.equal(name.extracted.full_name, 'Juan')
  const financing = await run('Juan Pérez', { full_name: 'Juan Pérez' })
  assert.equal(financing.extracted.full_name, 'Juan Pérez')
  assert.equal(financing.extracted.lead_profile.full_name, null)
})

test('profile evidence cannot come from stale history, contact origin, project location or a declined residence', async () => {
  const cases = [
    ['Quiero el precio', 'Madrid', 'vivo en Madrid'],
    ['Escribo desde Madrid', 'Madrid', 'Escribo desde Madrid'],
    ['Escribo desde Madrid', 'Madrid', 'Madrid'],
    ['El proyecto está en Cuenca', 'Cuenca', 'El proyecto está en Cuenca'],
    ['Soy de Loja', 'Loja', 'Soy de Loja'],
    ['Estoy en Madrid de vacaciones', 'Madrid', 'Estoy en Madrid de vacaciones'],
    ['Ya no vivo en Madrid', 'Madrid', 'Ya no vivo en Madrid'],
    ['Antes vivía en Madrid', 'Madrid', 'Madrid'],
    ['Quiero vivir en Madrid', 'Madrid', 'Madrid'],
  ]
  for (const [current, city, evidence] of cases) {
    const result = await interpretConversationTurn({ mensaje_actual: current,
      pregunta_pendiente: { id: 'lead_profile_residence' }, historial: [{ role: 'cliente', content: 'vivo en Madrid' }] }, {
      activePrompt: async () => 'Prompt', aiJson: async () => ({ residence_city: city, profile_evidence: { residence_city: evidence } }),
    })
    assert.equal(result.extracted.residence_city, null, current)
  }
  const country = await interpretConversationTurn({ mensaje_actual: 'Vivo en Estados Unidos' }, {
    activePrompt: async () => 'Prompt', aiJson: async () => ({ residence_country: 'Estados Unidos',
      profile_evidence: { residence_country: 'Vivo en Estados Unidos' } }),
  })
  assert.equal(country.extracted.residence_city, null)
  assert.equal(country.extracted.residence_country, 'Estados Unidos')
})

test('one extraction preserves reservation, prior refusal and simultaneous questions with canonical diagnostics', async () => {
  const current = 'Por ahora no, quiero separar el departametno 605. ¿Y qué documentos necesito?'
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: { id: 'budget_amount' } }, {
    activePrompt: async () => 'Prompt', aiJson: async (rules, _input, schema) => {
      assert.ok(schema.properties.turn_semantics.required.includes('reservation'))
      assert.match(rules, /asked_reservation.*nunca reemplaza esa distinción/)
      return { events: [], requests: [
        { domain: 'advisor', request: 'Iniciar la separación del 605', evidence: 'quiero separar el departametno 605', confidence: 'high' },
        { domain: 'property', request: 'Documentos necesarios', evidence: '¿Y qué documentos necesito?', confidence: 'high' },
      ], turn_semantics: {
        primary_intent: 'answer_previous', primary_evidence: 'Por ahora no', confidence: 'high',
        answer_to_previous: { question_id: 'budget_amount', kind: 'negative', evidence: 'Por ahora no', confidence: 'high' },
        reservation: { kind: 'request', evidence: 'quiero separar el departametno 605', unit_numbers: ['605'], confidence: 'high' },
        property: { operation: 'select', reference_kind: 'explicit', unit_numbers: ['605'], evidence: 'departametno 605', confidence: 'high' },
      } }
    },
  })
  assert.equal(result.semantics.primary_intent, 'request_reservation')
  assert.equal(result.semantics.answer_to_previous.kind, 'negative')
  assert.equal(result.semantics.reservation.kind, 'request')
  assert.ok(result.extracted.events.includes('asked_reservation'))
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.requests.length, 2)
  assert.equal(result.diagnostic.reservation.kind, 'request')
  assert.equal(result.diagnostic.interpretation.extractor_primary_intent, 'answer_previous')
})

test('an old reservation event alone is scoring evidence and cannot manufacture an operational request', async () => {
  const result = await interpretConversationTurn({ mensaje_actual: '¿Cuánto se paga para reservar?' }, {
    activePrompt: async () => 'Prompt', aiJson: async () => ({ events: ['asked_reservation'] }),
  })
  assert.equal(result.semantics.reservation.kind, 'none')
  assert.equal(result.extracted.requested_advisor, false)
  assert.notEqual(result.semantics.primary_intent, 'request_reservation')
})

test('reservation outside the authorized action fragment cannot start the real estate process', async () => {
  const current = 'Quiero reservar un vuelo; además, ¿dónde está La Vilet?'
  const result = await interpretConversationTurn({ mensaje_actual: current, mensaje_accion: '¿dónde está La Vilet?' }, {
    activePrompt: async () => 'Prompt', aiJson: async () => ({ turn_semantics: {
      primary_intent: 'request_reservation', primary_evidence: 'Quiero reservar un vuelo', confidence: 'high',
      reservation: { kind: 'request', evidence: 'Quiero reservar un vuelo', unit_numbers: [], confidence: 'high' },
    } }),
  })
  assert.equal(result.semantics.reservation.kind, 'none')
  assert.equal(result.semantics.primary_intent, 'other')
  assert.ok(!result.extracted.events.includes('asked_reservation'))
})
