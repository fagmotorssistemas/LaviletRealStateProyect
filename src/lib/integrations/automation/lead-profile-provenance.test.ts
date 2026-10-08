import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLeadProfile, mergeLeadProfile } from './lead-profile'
import { object, type Row } from './data'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { interpretConversationTurn } from './turn-interpretation'
import { TurnInterpretationError } from './turn-interpretation-input'

test('the same origin citation cannot also confirm current residence', () => {
  for (const kind of ['origin', 'temporary', 'former', 'future', 'unspecified']) {
    const message = 'Soy de Cuenca', normalized = normalizeLeadProfile({ residence_city: 'Cuenca',
      profile_evidence: { residence_city: message }, declared_location: { city: 'Cuenca', kind, evidence: message } }, message, {})
    assert.equal(normalized.residence_city, null, kind)
    assert.equal(object(normalized.declared_location).city, 'Cuenca')
    assert.equal(normalized.residence_status, ['origin', 'unspecified'].includes(kind) ? 'pending_confirmation' : 'unknown')
    const saved = mergeLeadProfile({}, normalized)
    assert.equal(saved.residence_city, undefined)
    assert.notEqual(saved.residence_status, 'confirmed')
  }
})

test('origin and explicit ongoing residence in the same city are compatible with distinct assertion sources', () => {
  const message = 'Soy de Cuenca y sigo viviendo allí'
  const normalized = normalizeLeadProfile({ residence_city: 'Cuenca',
    profile_evidence: { residence_city: message }, declared_location: { city: 'Cuenca', kind: 'origin', evidence: 'Soy de Cuenca' } }, message, {})
  assert.equal(normalized.residence_city, 'Cuenca')
  assert.equal(normalized.residence_status, 'confirmed')
  assert.equal(object(normalized.declared_location).kind, 'origin')
  const saved = mergeLeadProfile({}, normalized)
  assert.equal(object(object(saved.sources).residence_city).evidence, message)
})

test('a different current residence wins and keeps the original city as origin', () => {
  const message = 'Soy de Cuenca pero actualmente vivo en Quito'
  const normalized = normalizeLeadProfile({ residence_city: 'Quito',
    profile_evidence: { residence_city: 'actualmente vivo en Quito' },
    declared_location: { city: 'Cuenca', kind: 'origin', evidence: 'Soy de Cuenca' } }, message, {})
  assert.equal(normalized.residence_city, 'Quito')
  assert.equal(normalized.residence_status, 'confirmed')
  assert.equal(object(normalized.declared_location).city, 'Cuenca')
})

test('only the saved confirmation with that same non-current citation becomes pending again', () => {
  const message = 'Soy de Cuenca', incoming = normalizeLeadProfile({ residence_city: 'Cuenca',
    profile_evidence: { residence_city: message }, declared_location: { city: 'Cuenca', kind: 'origin', evidence: message } }, message, {})
  const previouslyMisclassified = { residence_city: 'Cuenca', residence_status: 'confirmed',
    sources: { residence_city: { source: 'lead_declaration', evidence: message } } }
  const corrected = mergeLeadProfile(previouslyMisclassified, incoming)
  assert.equal(corrected.residence_city, undefined)
  assert.equal(corrected.residence_status, 'pending_confirmation')
  assert.equal(object(corrected.residence_candidate).city, 'Cuenca')
  const confirmedIndependently = mergeLeadProfile({ ...previouslyMisclassified,
    sources: { residence_city: { source: 'lead_declaration', evidence: 'Ahora vivo en Cuenca' } } }, incoming)
  assert.equal(confirmedIndependently.residence_city, 'Cuenca')
  assert.equal(confirmedIndependently.residence_status, 'confirmed')
})

test('shared origin/residence citations receive focused semantic recovery for both a simple and compound declaration', async () => {
  for (const current of ['Soy de Cuenca', 'Soy de Cuenca y sigo viviendo allí']) {
    const raw: Row = structuredClone(profileFixture)
    raw.full_name = null; raw.residence_city = 'Cuenca'; raw.residence_country = null
    raw.profile_evidence = { full_name: null, residence_city: current, residence_country: null }
    raw.declared_location = { city: 'Cuenca', country: null, kind: 'origin', evidence: current }
    raw.requests = []
    object(raw.turn_semantics).primary_intent = 'other'
    object(raw.turn_semantics).primary_evidence = current
    object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async (_rules, input, schema) => {
        calls++
        if (calls === 1) return raw
        assert.deepEqual(object(object(input).recuperacion_interpretacion).issues, ['ambiguous_profile_location_source'])
        assert.equal(object(schema?.properties).financing_consent, undefined)
        assert.equal(object(input).historial, undefined)
        const ongoing = current !== 'Soy de Cuenca'
        return { residence_city: ongoing ? 'Cuenca' : null, residence_country: null,
          profile_evidence: { residence_city: ongoing ? current : null, residence_country: null },
          declared_location: { city: 'Cuenca', country: null, kind: 'origin', evidence: 'Soy de Cuenca' } }
      },
    })
    assert.equal(calls, 2)
    const profile = object(result.extracted.lead_profile)
    assert.equal(profile.residence_status, current === 'Soy de Cuenca' ? 'pending_confirmation' : 'confirmed')
    assert.equal(profile.residence_city, current === 'Soy de Cuenca' ? null : 'Cuenca')
    // A retry repeating the same unresolved citation is a bounded failure;
    // normalization must not guess whether the place is current.
    await assert.rejects(interpretConversationTurn({ mensaje_actual: current }, {
      activePrompt: async () => '', aiJson: async () => raw,
    }), (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('ambiguous_profile_location_source'))
  }
})
