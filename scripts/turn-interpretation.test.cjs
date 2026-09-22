/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { interpretConversationTurn, rememberInterpretedTurn, TURN_EXTRACTION_SCHEMA, CONVERSATION_CONTRACT_VERSION } = require('../src/lib/integrations/automation/turn-interpretation.ts')
const { TURN_SEMANTICS_SCHEMA } = require('../src/lib/integrations/automation/turn-semantics.ts')
const { unreadMediaMarker } = require('../src/lib/integrations/automation/media-format.ts')

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
  assert.match(calls[1].instructions, /lavilet-dialogue-v2/)
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
