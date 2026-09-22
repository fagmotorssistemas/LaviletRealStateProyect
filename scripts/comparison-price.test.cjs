/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.resolve(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { unitPriceQuote, priceReplyIssues, acceptedPriceOption } = require('../src/lib/integrations/automation/price-reply.ts')

const catalog = [
  { id: 'u101', unit_number: '101', category: 'departamento', bedrooms: 2, published_commercial_price: 210000, is_published: true, status: 'disponible' },
  { id: 'u202', unit_number: '202', category: 'departamento', bedrooms: 3, published_commercial_price: 250000, is_published: true, status: 'disponible' },
  { id: 'u302', unit_number: '302', category: 'departamento', bedrooms: 3, published_commercial_price: 270000, is_published: true, status: 'disponible' },
  { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, published_commercial_price: 310000, is_published: true, status: 'disponible' },
  { id: 'u602', unit_number: '602', category: 'penthouse', bedrooms: 3, published_commercial_price: 550000, is_published: true, status: 'disponible' },
]
function info(overrides = {}) {
  return { catalogo: catalog, modo_comercial: 'lanzamiento', politica_comercial: { precios_autorizados: true, precios_aproximados: true },
    lead: { preferred_category: 'penthouse' }, property_context: { comparison_ids: ['u202', 'u302'], selected_ids: [], offered_ids: ['u101', 'u202', 'u302', 'u502'] },
    historial: [{ role: 'cliente', content: '¿Cuál es la diferencia entre el 202 y el 302?' }, { role: 'bot', content: 'El departamento 202 está en la segunda planta y el 302 en la tercera.' }],
    ...overrides }
}

test('price follow-ups keep both compared units despite stale category, selection and offered inventory', () => {
  for (const current of ['¿Y en precio?', 'y el precio?', '¿Tienen el mismo precio?', 'Dime cuánto cuestan']) {
    const result = unitPriceQuote(info(), current, { _unit_reference: { ids: ['u602'] } })
    assert.equal(result.quoted, true, current)
    assert.deepEqual(result.units.map(unit => unit.id), ['u202', 'u302'])
    assert.match(result.reply, /202.*250[.,]000.*302.*270[.,]000/)
    assert.match(result.reply, /diferencia es de \$20[.,]000 USD/)
    assert.doesNotMatch(result.reply, /210[.,]000|310[.,]000|550[.,]000/)
    assert.deepEqual(priceReplyIssues(result.reply, info(), current, result.prices), [])
  }
})

test('fresh named unit replaces prior comparison and stale supplied reference', () => {
  const context = info({ referencia_unidad: { matches: [catalog[1], catalog[2]] } })
  const result = unitPriceQuote(context, 'Precio del penthouse 602', {})
  assert.deepEqual(result.units.map(unit => unit.id), ['u602'])
  assert.match(result.reply, /penthouse 602/)
  assert.equal(result.comparison, undefined)
})

test('vetted semantic reference has priority and hydrates prices from authorized catalog', () => {
  const context = info({ referencia_unidad: { reason: 'semantic_explicit', hasUnitMention: true, matches: [{ id: 'u602', published_commercial_price: 1 }] } })
  const result = unitPriceQuote(context, 'No el departamento 202, quiero el precio del penthouse 602', {})
  assert.deepEqual(result.units.map(unit => unit.id), ['u602'])
  assert.match(result.reply, /550[.,]000/)
  assert.doesNotMatch(result.reply, /250[.,]000|\$1\b/)
})

test('an explicit category price request replaces a stored comparison', () => {
  const result = unitPriceQuote(info(), '¿Qué precios tienen todos los departamentos?', {})
  assert.deepEqual(result.units.map(unit => unit.id), ['u101', 'u202', 'u302', 'u502'])
  assert.equal(result.comparison, undefined)
})

test('uncertain references and missing comparison members do not reuse old prices', () => {
  assert.equal(unitPriceQuote(info({ referencia_unidad: { needsClarification: true, matches: [] } }), '¿Y el precio?', {}), null)
  assert.equal(unitPriceQuote(info({ property_context: { comparison_ids: ['u202', 'unknown'] } }), '¿Y en precio?', {}), null)
  const missing = unitPriceQuote(info(), 'Precio del departamento 999', { _unit_reference: { ids: ['u202'] } })
  assert.equal(missing.quoted, false)
  assert.doesNotMatch(missing.reply, /\$/)
})

test('all response modes use the same reference and pricing policy', () => {
  for (const mode of ['formal', 'consultivo', 'cercano', 'directo']) {
    const launch = unitPriceQuote(info({ modo_ia: mode }), '¿Y en precio?', {})
    const presale = unitPriceQuote(info({ modo_ia: mode, modo_comercial: 'preventa', politica_comercial: { precios_autorizados: true, precios_aproximados: false } }), '¿Y en precio?', {})
    assert.deepEqual(launch.prices, [250000, 270000])
    assert.deepEqual(presale.prices, launch.prices)
    assert.match(launch.reply, /referenciales de lanzamiento/)
    assert.doesNotMatch(presale.reply, /aproximad|referencial|lanzamiento/)
  }
})

test('hidden, unpublished, unavailable and missing prices never supply a computed comparison', () => {
  const hidden = unitPriceQuote(info({ politica_comercial: { precios_autorizados: false } }), '¿Y en precio?', {})
  assert.equal(hidden.quoted, false)
  assert.equal(hidden.reply, '')
  for (const patch of [{ is_published: false }, { status: 'vendido' }, { published_commercial_price: null }]) {
    const changed = catalog.map(unit => unit.id === 'u302' ? { ...unit, ...patch } : unit)
    const result = unitPriceQuote(info({ catalogo: changed }), '¿Y en precio?', {})
    assert.equal(result.comparison, undefined)
    assert.doesNotMatch(result.reply, /270[.,]000|20[.,]000/)
  }
})

test('comparison arithmetic is calculated in cents and equal prices do not invent a difference', () => {
  const decimal = catalog.map(unit => ({ ...unit, published_commercial_price: unit.id === 'u202' ? 250000.10 : unit.id === 'u302' ? 270000.30 : unit.published_commercial_price }))
  const result = unitPriceQuote(info({ catalogo: decimal }), '¿Y en precio?', {})
  assert.equal(result.comparison.difference, 20000.20)
  assert.match(result.reply, /20[.,]000[.,]2 USD/)
  assert.deepEqual(priceReplyIssues(result.reply, info({ catalogo: decimal }), '¿Y en precio?', result.prices), [])
  const equal = catalog.map(unit => unit.id === 'u302' ? { ...unit, published_commercial_price: 250000 } : unit)
  assert.match(unitPriceQuote(info({ catalogo: equal }), '¿Y en precio?', {}).reply, /Ambas opciones tienen el mismo precio/)
})

test('review accepts only the verified difference in a difference phrase, not as a unit price', () => {
  const suffix = ' Son valores referenciales de lanzamiento.'
  assert.deepEqual(priceReplyIssues('El 202 vale $250.000 USD; el 302, $270.000 USD. La diferencia es de $20.000 USD.' + suffix, info(), '¿Y en precio?', [250000, 270000]), [])
  for (const reply of [
    'El precio del 202 es $20.000 USD.',
    'El 302 cuesta $270.000 USD. La diferencia es de $250.000 USD.',
    'La diferencia es de $25.000 USD.',
    'La diferencia es de $20.000 USD. El 202 cuesta $20.000 USD.',
    'El precio del 202 es $250.000 EUR.',
  ]) assert.deepEqual(priceReplyIssues(reply + suffix, info(), '¿Y en precio?', [250000, 270000]), ['unsupported_fact'], reply)
})

test('accepting several quoted options does not choose the cheapest on behalf of the client', () => {
  const context = info({ historial: [{ role: 'bot', content: 'Podemos revisar el departamento 202 o el departamento 302. ¿Le gustaría conocer estas opciones?' }] })
  assert.equal(acceptedPriceOption(context, 'Sí por favor', {}), null)
})
