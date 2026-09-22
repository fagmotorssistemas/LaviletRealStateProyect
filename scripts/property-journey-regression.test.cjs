/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.resolve('src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { continueUnitAlternative } = require('../src/lib/integrations/automation/unit-alternatives.ts')
const { preferredPropertyCategory, propertySelectionReply } = require('../src/lib/integrations/automation/property-selection.ts')

const unit = (id, category, area, floor, price) => ({
  id, unit_number: id, category, area_internal_m2: area, floor_number: floor,
  floor: `Planta ${floor}`, bedrooms: 3, status: 'disponible', is_published: true,
  published_commercial_price: price,
})
const catalog = [unit('202', 'departamento', 120.83, 2, 250000), unit('302', 'departamento', 120.83, 3, 270000),
  unit('602', 'penthouse', 142.09, 6, 550000), unit('605', 'penthouse', 140.53, 6, 540000)]
const info = {
  catalogo: catalog, historial: [], lead: { preferred_category: 'departamento' },
  politica_comercial: { precios_autorizados: true, precios_aproximados: true },
}
const semantic = (category, overrides = {}) => ({
  primary_intent: 'select_property', property: {
    category, excluded_categories: [], reference_kind: 'none', confidence: 'high', ...overrides,
  },
})
const context = phase => ({ journey: 'residential_alternatives', phase })
const question = 'Contamos con departamentos de 3 dormitorios y penthouses. ¿Desea revisar primero los departamentos o los penthouses?'

test('the positively chosen category wins over an objection mentioning another category', () => {
  for (const message of [
    'bueno, me interesa mas los departamentos por que los penthouse deben ser muy caros.',
    'No quiero penthouses, prefiero departamentos',
    'Prefiero departamentos y no penthouses',
    'Prefiero departamentos a los penthouses',
    'los penthouses son caros pero me interesan los departamentos',
  ]) assert.equal(preferredPropertyCategory(message), 'departamento', message)
  assert.equal(preferredPropertyCategory('Prefiero penthouses, no departamentos'), 'penthouse')
  for (const message of ['No quiero departamentos', 'Los penthouses son caros', 'No estoy seguro si quiero departamentos',
    'Quiero comparar departamentos y penthouses', 'Me interesan departamentos y suites']) {
    assert.equal(preferredPropertyCategory(message), null, message)
  }
})

test('normalized high-confidence semantics choose the category without keyword overrides', () => {
  assert.equal(preferredPropertyCategory('me interesa mas los departametos, los penthouse son caros', semantic('departamento', { excluded_categories: ['penthouse'] })), 'departamento')
  assert.equal(preferredPropertyCategory('prefiero departamentos', semantic(null)), null)
  assert.equal(preferredPropertyCategory('prefiero departamentos', semantic('departamento', { excluded_categories: ['departamento'] })), null)
})

test('category, floor and singleton confirmation remain separate choices in all configured tones', () => {
  for (const tone of ['formal', 'cercano', 'directo', 'premium']) {
    const first = continueUnitAlternative({ ...info, tono: tone, historial: [{ role: 'bot', content: question }] },
      'bueno, me interesa mas los departamentos por que los penthouse deben ser muy caros.')
    assert.equal(first.phase, 'choose_floor')
    assert.match(first.reply, /Planta 2, Planta 3/)
    assert.doesNotMatch(first.reply, /602|605|360|https:|cuántos dormitorios/i)
    const floor = continueUnitAlternative({ ...info, tono: tone, property_context: context(first.phase),
      historial: [{ role: 'bot', content: '¿Cuál de las plantas que vimos prefiere?' }] }, 'segunda planta')
    assert.equal(floor.phase, 'choose_unit')
    assert.deepEqual(floor.offered_unit_ids, ['202'])
    assert.equal(floor.unit, undefined)
    assert.doesNotMatch(floor.reply, /https:|360|presupuesto/)
    const accepted = continueUnitAlternative({ ...info, tono: tone, property_context: context(floor.phase),
      referencia_unidad: { matches: [catalog[0]], explicit: false }, historial: [{ role: 'bot', content: floor.reply }] }, 'si por favor')
    assert.equal(accepted.phase, 'review_unit')
    assert.deepEqual(accepted.selected_unit_ids, ['202'])
    assert.match(accepted.reply, /\/tour\?unidad=202/)
  }
})

test('a list asks which option to know and records offers without selecting them', () => {
  const result = continueUnitAlternative({ ...info, historial: [{ role: 'bot', content: question }] }, 'prefiero los penthouses')
  assert.equal(result.phase, 'choose_unit')
  assert.deepEqual(result.offered_unit_ids, ['602', '605'])
  assert.match(result.reply, /¿Cuál de estas opciones le gustaría conocer\?/)
  assert.doesNotMatch(result.reply, /360|https:/)
  assert.equal(result.unit, undefined)
})

test('a resolved relative choice uses the newly presented set despite an older category', () => {
  const result = continueUnitAlternative({ ...info, property_context: context('choose_unit'),
    historial: [{ role: 'bot', content: 'Opciones: penthouse 602 y penthouse 605. ¿Cuál prefiere?' }],
    referencia_unidad: { matches: [catalog[2]], explicit: false },
    semantica_turno: semantic(null, { reference_kind: 'relative', selector: 'largest' }),
  }, 'me interesa mas el mas grande')
  assert.equal(result.unit.id, '602')
  assert.match(result.reply, /142[.,]09/)
  assert.match(result.reply, /\/tour\?unidad=602/)
  assert.doesNotMatch(result.reply, /departamento 202|departamento 302/)
})

test('ambiguity, price requests and unavailable references cannot force a tour', () => {
  const base = { ...info, property_context: context('choose_unit') }
  assert.equal(continueUnitAlternative({ ...base, referencia_unidad: { matches: [catalog[2]], needsClarification: true } }, 'el mas grande'), null)
  assert.equal(continueUnitAlternative({ ...base, referencia_unidad: { matches: [catalog[2]], explicit: true } }, 'y el precio del 602?'), null)
  assert.equal(continueUnitAlternative({ ...base, catalogo: catalog.filter(u => u.id !== '602'),
    referencia_unidad: { matches: [catalog[2]], explicit: true } }, 'quiero el 602'), null)
  assert.equal(continueUnitAlternative({ ...info, property_context: { phase: 'choose_category' },
    historial: [{ role: 'bot', content: '¿Le interesan suites o locales comerciales?' }] }, 'si'), null)
})

test('general property selection shares semantic category and relative selection rules', () => {
  const selection = propertySelectionReply({ ...info,
    semantica_turno: semantic('departamento', { excluded_categories: ['penthouse'] }),
  }, 'me interesa mas los departametos, los penthouse son caros')
  assert.equal(selection.audit.category, 'departamento')
  assert.match(selection.reply, /departamentos/)
  assert.doesNotMatch(selection.reply, /penthouses/)
  const relative = propertySelectionReply({ ...info, referencia_unidad: { matches: [catalog[2]], explicit: false },
    semantica_turno: semantic(null, { reference_kind: 'relative', selector: 'largest' }),
  }, 'me quedo con el mayor')
  assert.equal(relative.audit.source, 'property_unit_selected')
  assert.deepEqual(relative.audit.selected_unit_ids, ['602'])
  assert.match(relative.reply, /penthouse 602/)
  assert.match(relative.reply, /\/tour\?unidad=602/)
})
