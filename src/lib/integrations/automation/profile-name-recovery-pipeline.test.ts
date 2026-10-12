import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedLeadName, mergeLeadProfile, normalizeLeadProfile } from './lead-profile'
import { interpretConversationTurn } from './turn-interpretation'
import { leadIntroductionTurn } from './lead-introduction'
import { sanitizeTraceSummary } from './trace-summary'
import { object, type Row } from './data'

const question = { id: 'lead_profile', act: 'profile',
  question: '¿Podría indicarnos su nombre y en qué ciudad o país reside actualmente?' }
const introduction = { version: 3, status: 'pending', request_sent: true,
  requested_fields: ['full_name', 'residence'], presentation_sent: true,
  brochure_sent: false, reminder_count: 0, continuation_reply: '¿Busca vivienda o un local comercial?' }
const input = { pregunta_pendiente: question, perfil_inicial: { awaiting: true, missing: ['full_name', 'residence_city'] },
  resumen: { _lead_introduction: introduction } }
const response = (status: string, evidence: string) => ({ status, evidence, confidence: 'high' })

test('an omitted current name is recovered alone and survives the later residence confirmation', async () => {
  const current = 'Me llamo Carlos y soy de Cuenca'
  const raw: Row = { full_name: null,
    profile_evidence: { full_name: null, residence_city: null, residence_country: null },
    declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'soy de Cuenca' },
    turn_semantics: { primary_intent: 'other', primary_evidence: current, confidence: 'high',
      answer_to_previous: { question_id: 'lead_profile', kind: 'value', evidence: current, confidence: 'high' } } }
  let calls = 0
  const first = await interpretConversationTurn({ ...input, mensaje_actual: current,
    contact_name: 'Nombre CRM', historial: [{ role: 'cliente', content: 'Antes me llamaba Pedro' }] }, {
    activePrompt: async () => '', aiJson: async (_rules, repairInput, schema) => {
      calls++
      if (calls === 1) return raw
      assert.deepEqual(Object.keys(object(schema?.properties)).sort(), ['full_name', 'name_response', 'profile_evidence'])
      assert.equal(object(repairInput).mensaje_actual, current)
      assert.equal(object(repairInput).historial, undefined)
      assert.equal(object(repairInput).contact_name, undefined)
      assert.equal(object(repairInput).perfil_inicial, undefined)
      return { full_name: 'Carlos', profile_evidence: { full_name: 'Me llamo Carlos' },
        name_response: response('declared', 'Me llamo Carlos') }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(first.extracted.lead_profile).full_name, 'Carlos')
  assert.equal(object(object(first.extracted.lead_profile).declared_location).city, 'Cuenca')
  assert.equal(first.diagnostic.profile_name_recovery.status, 'recovered')
  assert.equal(object(first.diagnostic.profile_name_recovery.initial_field_status).proposed_value_present, false)
  assert.doesNotMatch(JSON.stringify(first.diagnostic), /Carlos|Cuenca|Nombre CRM|Pedro/)
  const tracedFields = sanitizeTraceSummary({ profile_fields: first.diagnostic.profile_fields }).profile_fields as Row[]
  assert.equal(tracedFields.find(field => field.field === 'full_name')?.accepted, true,
    'the private value filter still permits value-free per-field diagnostics')
  const stored = mergeLeadProfile({}, first.extracted.lead_profile, { message_id: 'profile-message' })
  const confirmation = { id: 'lead_residence_confirmation', act: 'profile',
    question: '¿Cuenca es también su lugar de residencia actual?', residence_candidate: stored.residence_candidate }
  const answer = 'Sí, si vivo en Cuenca'
  const second = await interpretConversationTurn({ mensaje_actual: answer,
    perfil_inicial: stored, pregunta_pendiente: confirmation }, {
    activePrompt: async () => '', aiJson: async () => {
      calls++
      return { residence_city: 'Cuenca', profile_evidence: { residence_city: 'vivo en Cuenca' },
        turn_semantics: { primary_intent: 'answer_previous', primary_evidence: answer, confidence: 'high',
          answer_to_previous: { question_id: 'lead_residence_confirmation', kind: 'affirmative', evidence: answer, confidence: 'high' } } }
    },
  })
  assert.equal(calls, 3, 'no second identity recovery when the name is already confirmed')
  const complete = mergeLeadProfile(stored, second.extracted.lead_profile, { message_id: 'residence-message' })
  assert.equal(confirmedLeadName(complete), 'Carlos')
  assert.equal(object(object(complete.sources).full_name).message_id, 'profile-message')
  assert.equal(complete.residence_status, 'confirmed')
  const next = leadIntroductionTurn({ current: answer, summary: { _lead_profile: complete,
    _lead_introduction: { ...introduction, confirmation_asked: true } }, extracted: second.extracted,
    reply: '¿Busca vivienda o un local comercial?', audit: { source: 'commercial' } })
  assert.deepEqual(object(next.audit.profile_collection_decision).allowed_fields, [])
  assert.match(next.reply, /vivienda o un local comercial/)
  assert.doesNotMatch(next.reply, /indicarnos su nombre|cuál es su nombre/i)
})

test('normal profile answers, explicit absences and refusals do not pay for identity recovery', async () => {
  const cases: [string, Row][] = [
    ['Me llamo Ana y vivo en Loja', { full_name: 'Ana', residence_city: 'Loja',
      profile_evidence: { full_name: 'Me llamo Ana', residence_city: 'vivo en Loja' } }],
    ['Vivo en Loja', { residence_city: 'Loja', profile_evidence: { residence_city: 'Vivo en Loja' },
      name_response: response('not_declared', 'Vivo en Loja') }],
    ['Vivo en España', { residence_country: 'España', profile_evidence: { residence_country: 'Vivo en España' } }],
    ['No quiero dar mi nombre, vivo en España; sólo quiero información', { residence_country: 'España',
      profile_evidence: { residence_country: 'vivo en España' } }],
    ['Esa información prefiero reservármela', { name_response: response('declined', 'Esa información prefiero reservármela') }],
    ['Quiero un departamento de tres dormitorios', { turn_semantics: {
      primary_intent: 'select_property', primary_evidence: 'Quiero un departamento de tres dormitorios', confidence: 'high' } }],
  ]
  for (const [current, raw] of cases) {
    let calls = 0
    const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async () => { calls++; return raw },
    })
    assert.equal(calls, 1, current)
    assert.equal(result.diagnostic.profile_name_recovery.attempted, false, current)
    if (object(raw.name_response).status === 'declined') {
      const planned = leadIntroductionTurn({ current, summary: input.resumen, extracted: result.extracted,
        reply: '¿Busca vivienda o un local comercial?', audit: { source: 'commercial' } })
      assert.equal(object(planned.audit.profile_collection_decision).action, 'declined')
      assert.deepEqual(object(planned.audit.profile_collection_decision).allowed_fields, [])
      assert.doesNotMatch(planned.reply, /indicarnos su nombre|cuál es su nombre/i)
    }
  }
})

test('focused recovery records explicit absence instead of adopting a third-party or historical name', async () => {
  for (const [current, status] of [
    ['Mi hermana se llama Carla y somos de Loja', 'not_declared'],
    ['Vivo en Loja; mi nombre se lo proporcionaré luego', 'declined'],
    ['Si mi nombre fuera Juan, ¿qué necesitaría? Soy de Loja', 'not_declared'],
  ]) {
    let calls = 0
    const result = await interpretConversationTurn({ ...input, mensaje_actual: current,
      contact_name: 'Carla', historial: [{ role: 'cliente', content: 'Me llamo Juan' }] }, {
      activePrompt: async () => '', aiJson: async (_rules, repairInput) => {
        calls++
        if (calls === 1) return { declared_location: { city: 'Loja', kind: 'origin', evidence: 'Loja' },
          name_response: response('declared', current) }
        assert.equal(object(repairInput).historial, undefined)
        return { full_name: null, profile_evidence: { full_name: null }, name_response: response(status, current) }
      },
    })
    assert.equal(calls, 2)
    assert.equal(object(result.extracted.lead_profile).full_name, null)
    assert.equal(result.diagnostic.profile_name_recovery.status, status)
    assert.doesNotMatch(JSON.stringify(result.diagnostic), /Carla|Juan|Loja/)
  }
})

test('a repair with historical evidence cannot certify identity or modify accepted residence', async () => {
  const current = 'Soy de Loja'
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current }, {
    activePrompt: async () => '', aiJson: async () => {
      calls++
      return calls === 1 ? { declared_location: { city: 'Loja', kind: 'origin', evidence: current },
        name_response: response('declared', current) }
        : { full_name: 'Pedro', profile_evidence: { full_name: 'Me llamo Pedro' },
          name_response: response('declared', 'Me llamo Pedro'), residence_city: 'Quito' }
    },
  })
  assert.equal(calls, 2)
  assert.equal(object(result.extracted.lead_profile).full_name, null)
  assert.equal(object(object(result.extracted.lead_profile).declared_location).city, 'Loja')
  assert.equal(object(result.extracted.lead_profile).residence_city, null)
  assert.equal(result.diagnostic.profile_name_recovery.status, 'invalid_result')
})

test('profile field telemetry reports accept and reject reasons without private values or citations', () => {
  const current = 'Me llamo Carlos y vivo en Cuenca'
  const profile = normalizeLeadProfile({ full_name: 'Carlos', residence_city: 'Cuenca', residence_country: 'Ecuador',
    profile_evidence: { full_name: 'Me llamo Carlos', residence_city: 'vivo en Cuenca', residence_country: 'vivo en Cuenca' } }, current, {})
  assert.deepEqual(object(profile.field_status).full_name, { proposed_value_present: true, evidence_present: true,
    accepted: true, reason: 'current_literal_declaration' })
  assert.equal(object(object(profile.field_status).residence_country).reason, 'value_not_in_evidence')
  assert.doesNotMatch(JSON.stringify(profile.field_status), /Carlos|Cuenca|Ecuador|Me llamo|vivo/)
})

test('the first extraction requires a name outcome only for a delivered open name request with typed missing state', async () => {
  const current = 'Vivo en Cuenca'
  const known = mergeLeadProfile({}, { full_name: 'Carlos', evidence: { full_name: 'Me llamo Carlos' } })
  const cases: [Row, boolean][] = [
    [input, true],
    [{ pregunta_pendiente: question }, false],
    [{ ...input, pregunta_pendiente: { id: 'lead_profile_residence', act: 'profile' } }, false],
    [{ ...input, pregunta_pendiente: { id: 'budget_amount', act: 'budget' } }, false],
    [{ ...input, perfil_inicial: { ...known, awaiting: true, missing: ['full_name'] } }, false],
    [{ ...input, resumen: { _lead_introduction: { ...introduction, collection_status: 'declined' } } }, false],
    [{ ...input, resumen: { _lead_introduction: { ...introduction, request_sent: false } } }, false],
  ]
  for (const [context, required] of cases) {
    let calls = 0
    const result = await interpretConversationTurn({ ...context, mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async (_rules, _input, schema) => {
        calls++
        const nameSchema = object(object(schema?.properties).name_response)
        assert.equal(nameSchema.type === 'object', required)
        assert.equal(Array.isArray(nameSchema.anyOf), !required)
        return { residence_city: 'Cuenca', profile_evidence: { residence_city: current },
          name_response: response('not_declared', current) }
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.diagnostic.profile_name_recovery.attempted, false)
  }
})

test('a historical name citation alone does not trigger another model call during an unrelated residence answer', async () => {
  const current = 'Vivo en Loja'
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: current,
    historial: [{ role: 'cliente', content: 'Me llamo Pedro' }] }, {
    activePrompt: async () => '', aiJson: async () => {
      calls++
      return { full_name: null, profile_evidence: { full_name: 'Me llamo Pedro', residence_city: current }, residence_city: 'Loja' }
    },
  })
  assert.equal(calls, 1)
  assert.equal(object(result.extracted.lead_profile).full_name, null)
  assert.equal(result.diagnostic.profile_name_recovery.attempted, false)
})
