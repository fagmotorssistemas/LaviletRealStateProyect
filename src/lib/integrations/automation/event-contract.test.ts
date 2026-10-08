import { PROPERTY_CATEGORIES } from './property-category-contract'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONVERSATION_EVENTS, EXTRACTED_CONVERSATION_EVENTS, CONVERSATION_EVENT_DETAILS } from './event-contract'
import { TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { normalizeEvents } from './conversation-rules'
import { object } from './data'

test('schema and normalizer share the exact extracted event contract', () => {
  assert.deepEqual(object(object(object(TURN_EXTRACTION_SCHEMA.properties).events).items).enum, [...EXTRACTED_CONVERSATION_EVENTS])
  assert.equal(new Set(CONVERSATION_EVENTS).size, CONVERSATION_EVENTS.length)
  assert.ok(CONVERSATION_EVENTS.every(event => CONVERSATION_EVENT_DETAILS[event].title && CONVERSATION_EVENT_DETAILS[event].description))
  const message = 'Quiero un departamento para vivir'
  const normalized = normalizeEvents({ events: [...EXTRACTED_CONVERSATION_EVENTS, 'unknown_event'], preferred_category: 'departamento', purchase_purpose: 'vivir',
    declaration_evidence: { preferred_category: message, purchase_purpose: message } }, message)
  assert.deepEqual(normalized.events, [...CONVERSATION_EVENTS])
})

test('an explicitly declared penthouse retains the unit-type event with current evidence', () => {
  const message = 'Prefiero conocer los penthouses'
  const result = normalizeEvents({ events: ['declared_unit_type'], preferred_category: 'penthouse', declaration_evidence: { preferred_category: message } }, message)
  assert.equal(result.preferred_category, 'penthouse')
  assert.deepEqual(result.events, ['first_response', 'declared_unit_type'])
  assert.deepEqual(object(object(TURN_EXTRACTION_SCHEMA.properties).preferred_category).enum, [...PROPERTY_CATEGORIES, null])
})

test('a passive detail query about an inherited penthouse does not invent a new declaration event', () => {
  const result = normalizeEvents({ events: ['declared_unit_type'], preferred_category: 'penthouse',
    declaration_evidence: { preferred_category: 'Prefiero conocer los penthouses' } }, '¿Qué incluye esta opción?')
  assert.equal(result.preferred_category, null)
  assert.deepEqual(result.events, ['first_response'])
})
