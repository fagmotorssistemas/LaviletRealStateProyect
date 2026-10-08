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
const { verifiedPriceReplyIssues } = require('../src/lib/integrations/automation/price-reply.ts')

test('price evidence rejects swapped unit prices while launch wording belongs to the reviewer', () => {
  const quote = unitPriceQuote(info(), '¿Y en precio?', {})
  const swapped = 'El departamento 202 cuesta $270.000 USD; el departamento 302 cuesta $250.000 USD. La diferencia es de $20.000 USD. Son valores referenciales de lanzamiento y pueden cambiar.'
  assert.ok(verifiedPriceReplyIssues(swapped, info(), '¿Y en precio?', quote).includes('price_unit_mismatch'))
  assert.ok(!verifiedPriceReplyIssues('El departamento 202 cuesta $250.000 USD y el departamento 302 $270.000 USD.', info(), '¿Y en precio?', quote).includes('unsupported_fact'))
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, info(), '¿Y en precio?', quote), [])
})

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
    assert.match(launch.reply, /referenciales vigentes/)
    assert.doesNotMatch(launch.reply, /lanzamiento/)
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
  const suffix = ' Son valores referenciales de lanzamiento y pueden cambiar.'
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


test('generic price followup quotes only offered units, grouped by category and bedrooms',()=>{
 const offered=['u202','u302','u502','u602'];
 const input={catalogo:catalog,politica_comercial:{precios_autorizados:true,precios_aproximados:true},property_context:{offered_ids:offered},lead:{preferred_bedrooms:5}};
 const quote=unitPriceQuote(input,'Pero y cuales son los precios?',{});
 assert.equal(quote.quoted,true);
 assert.deepEqual(quote.units.map(u=>u.id),offered);
 assert.deepEqual(quote.ranges.map(r=>[r.category,r.bedrooms,r.min,r.max]),[['departamento',3,250000,310000],['penthouse',3,550000,550000]]);
 assert.match(quote.reply,/departamentos de 3 dormitorios/);
 assert.match(quote.reply,/penthouses de 3 dormitorios/);
 assert.doesNotMatch(quote.reply,/5 dormitorios|210[.,]000|departamento 202/);
 assert.deepEqual(verifiedPriceReplyIssues(quote.reply,input,'Pero y cuales son los precios?',quote),[]);
 const changed=unitPriceQuote(input,'Precio de departamentos de 2 dormitorios',{});
 assert.deepEqual(changed.units.map(u=>u.id),['u101']);
 assert.equal(unitPriceQuote({...input,politica_comercial:{precios_autorizados:false}},'Y los precios?',{}).quoted,false);
 const partial=unitPriceQuote({...input,catalogo:catalog.map(u=>u.id==='u302'?{...u,published_commercial_price:null}:u)},'Y los precios?',{});
 assert.equal(partial.ranges[0].complete,false);
 assert.match(partial.reply,/con precio publicado/);
});

test('a first price question quotes the authorized available catalogue range without inventing a category', () => {
  const input = info({ alcance_negocio: 'property', lead: {}, property_context: {}, historial: [], catalogo: [
    { id: 's101', unit_number: '101', category: 'suite', published_commercial_price: 100000, is_published: true, status: 'disponible' },
    ...catalog,
    { id: 'l101', unit_number: 'LC01', category: 'local', published_commercial_price: 70000, is_published: true, status: 'disponible' },
    { id: 'hidden', category: 'suite', published_commercial_price: 1, is_published: false },
    { id: 'sold', category: 'penthouse', published_commercial_price: 9000000, status: 'vendido' },
    { id: 'parking', category: 'parqueadero', published_commercial_price: 15000 },
  ] })
  const quote = unitPriceQuote(input, 'Precio', {})
  assert.equal(quote.quoted, true)
  assert.match(quote.reply, /inmuebles disponibles.*70[.,]000.*550[.,]000/)
  assert.doesNotMatch(quote.reply, /departamentos|suite|penthouse|local|15[.,]000|9[.,]000[.,]000/)
  assert.deepEqual(quote.ranges, [{ category: 'inmueble', bedrooms: 0, min: 70000, max: 550000, complete: true }])
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, input, 'Precio', quote), [])
  assert.deepEqual(priceReplyIssues(quote.reply, input, 'Precio'), [])
  assert.ok(verifiedPriceReplyIssues(quote.reply.replace('70.000', '60.000'), input, 'Precio', quote).includes('unsupported_fact'))
  const explicit = unitPriceQuote(input, 'Precio de los departamentos de 3 dormitorios', {})
  assert.deepEqual(explicit.prices, [250000, 270000, 310000])
})

test('general prices preserve authorization, missing-price disclosure and catalogue scope', () => {
  const input = info({ alcance_negocio: 'property', lead: {}, property_context: {}, historial: [] })
  const forbidden = unitPriceQuote({ ...input, politica_comercial: { precios_autorizados: false } }, 'Precio', {})
  assert.equal(forbidden.quoted, false)
  assert.doesNotMatch(forbidden.reply, /\$/)
  const missing = unitPriceQuote({ ...input, catalogo: catalog.map(unit => ({ ...unit, published_commercial_price: null })) }, 'Precio', {})
  assert.equal(missing.quoted, false)
  assert.equal(missing.needsAdvisor, undefined)
  assert.match(missing.reply, /No tengo un rango/)
  assert.doesNotMatch(missing.reply, /\$/)
  const partialInput = { ...input, catalogo: catalog.map(unit => unit.id === 'u602' ? { ...unit, published_commercial_price: null } : unit) }
  const partial = unitPriceQuote(partialInput, 'Precio', {})
  assert.match(partial.reply, /con precio publicado/)
  assert.equal(partial.ranges[0].complete, false)
  assert.equal(partial.ranges[0].max, 310000)
  assert.deepEqual(verifiedPriceReplyIssues(partial.reply, partialInput, 'Precio', partial), [])
  const limited = unitPriceQuote({ ...input, semantica_turno: { property: { excluded_categories: ['penthouse'], group: 'residential' } } }, 'Precio', {})
  assert.equal(limited.ranges[0].max, 310000)
  assert.doesNotMatch(limited.reply, /550[.,]000/)
  assert.equal(unitPriceQuote({ ...input, alcance_negocio: 'out_of_scope' }, 'Precio', {}).quoted, false)
})

test('the shared price objective answers a category clarification using its original text', () => {
  const input = info({ alcance_negocio: 'property', lead: {}, property_context: {}, historial: [],
    contrato_turno: { objective: 'ask_price' }, semantica_turno: { primary_intent: 'ask_price', property: { category: 'departamento' } } })
  const original = 'Sobre departamentos por favor'
  const quote = unitPriceQuote(input, original, {})
  assert.equal(quote.quoted, true)
  assert.deepEqual(quote.prices, [210000, 250000, 270000, 310000])
  assert.equal(original, 'Sobre departamentos por favor')
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, input, original, quote), [])
  for (const current of ['Precio del crédito', 'Costo de parqueadero', 'Precio de la alícuota', 'Cuánto cuesta el alquiler', 'Sobre el crédito', 'El parqueadero por favor', 'De la alícuota']) {
    assert.equal(unitPriceQuote(input, current, {}), null, current)
  }
  assert.equal(unitPriceQuote({ ...input, alcance_negocio: 'out_of_scope' }, original, {}), null)
  assert.equal(unitPriceQuote({ ...input, contrato_turno: { objective: 'select_property' } }, original, {}), null)
})

test('inherited price requests execute the same resolved floor, bedroom and area filters as the catalogue', () => {
  const units = [
    { id: 's201', unit_number: '201', category: 'suite', bedrooms: 1, floor_number: 2, area_internal_m2: 60, published_commercial_price: 150000 },
    { id: 's301', unit_number: '301', category: 'suite', bedrooms: 1, floor_number: 3, area_internal_m2: 60, published_commercial_price: 180000 },
    { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 2, floor_number: 2, area_internal_m2: 90, published_commercial_price: 210000 },
    { id: 'd203', unit_number: '203', category: 'departamento', bedrooms: 3, floor_number: 2, area_internal_m2: 120, published_commercial_price: 270000 },
  ]
  const input = info({ alcance_negocio: 'property', lead: {}, property_context: {}, historial: [], catalogo: units,
    contrato_turno: { objective: 'ask_price' } })
  for (const [current, category, filters, expected] of [
    ['En segunda planta', 'suite', { floor_number: 2 }, ['s201']],
    ['De dos dormitorios', 'departamento', { bedrooms: 2 }, ['d202']],
    ['Con al menos 100 metros', 'departamento', { min_area_m2: 100 }, ['d203']],
    ['De dos o tres dormitorios', 'departamento', { bedrooms_any: [2, 3] }, ['d202', 'd203']],
  ]) {
    const query = { category, group: 'residential', filters, operation: 'search', scope: 'catalog' }
    const context = { ...input, property_context: { query }, referencia_unidad: { reason: 'catalog_search', explicit: false, query, matches: [] },
      semantica_turno: { property: { category, filters, operation: 'search', confidence: 'high' } } }
    const quote = unitPriceQuote(context, current, {})
    assert.equal(quote.quoted, true, current)
    assert.deepEqual(quote.units.map(unit => unit.id), expected, current)
    assert.deepEqual(verifiedPriceReplyIssues(quote.reply, context, current, quote), [], current)
  }
  const unavailableQuery = { category: 'departamento', filters: { floor_number: 7, bedrooms: 3 }, operation: 'search', scope: 'catalog' }
  const missing = unitPriceQuote({ ...input, referencia_unidad: { query: unavailableQuery, explicit: false, reason: 'catalog_no_match', matches: [] }, property_context: { query: unavailableQuery } }, 'En séptima planta', {})
  assert.equal(missing.quoted, false)
  assert.equal(missing.needsAdvisor, undefined)
  assert.match(missing.reply, /No encuentro inmuebles disponibles que coincidan/)
  assert.doesNotMatch(missing.reply, /\$/)
})

test('a fresh category price query replaces legacy filters while equivalent explicit unit codes outrank search constraints', () => {
  const suite = { id: 's201', unit_number: '201', category: 'suite', bedrooms: 1, floor_number: 2, area_internal_m2: 60, published_commercial_price: 150000 }
  const local = { id: 'l05', unit_number: 'LC-05', category: 'local', floor_number: 0, area_internal_m2: 70, published_commercial_price: 200000 }
  const input = info({ alcance_negocio: 'property', catalogo: [suite, local, ...catalog], lead: {}, historial: [],
    property_context: { query: { category: 'penthouse', operation: 'search', filters: { min_area_m2: 140, floor_number: 6 } } } })
  assert.deepEqual(unitPriceQuote(input, 'Precio de suites', {}).prices, [150000])
  for (const current of ['Precio del LC05', 'Precio del local 5', 'Precio del local LC-05']) {
    const quote = unitPriceQuote(input, current, {})
    assert.equal(quote.quoted, true, current)
    assert.deepEqual(quote.units.map(unit => unit.id), ['l05'], current)
    assert.deepEqual(quote.prices, [200000], current)
  }
})

test('a focused price quote explains the bedroom filter and verified common floor before offering details', () => {
  const units = [
    { id: 'p601', unit_number: '601', category: 'penthouse', bedrooms: 2, floor_number: 6, floor: 'Sexta Planta Alta', published_commercial_price: 400000 },
    { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, floor: 'Sexta Planta Alta', published_commercial_price: 550000 },
    { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, floor: 'Sexta Planta Alta', published_commercial_price: 550000 },
  ]
  const query = { category: 'penthouse', operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } }
  const input = info({ catalogo: units, historial: [], property_context: { query },
    referencia_unidad: { reason: 'catalog_search', explicit: false, query, matches: units.slice(1) } })
  const quote = unitPriceQuote(input, '¿Y cuál es el precio de los penthouses?', {})
  assert.equal(quote.reply, 'Los penthouses de 3 dormitorios son el 602 y el 605, ambos ubicados en la sexta planta alta, con un valor referencial vigente de $550.000 USD cada uno, sujeto a cambios. ¿Le gustaría obtener más detalles de alguna de estas opciones?')
  assert.deepEqual(quote.followUp, { question: '¿Le gustaría obtener más detalles de alguna de estas opciones?',
    purpose: 'explore_quoted_options', candidate_ids: ['p602', 'p605'], category: 'penthouse', bedrooms: 3 })
  assert.equal(quote.comparison, undefined)
  assert.doesNotMatch(quote.reply, /601|400[.,]000|económic|financiamiento|menos dormitorios/)
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, input, '¿Y cuál es el precio de los penthouses?', quote), [])
  assert.equal(acceptedPriceOption({ ...input, historial: [{ role: 'bot', content: quote.reply }] }, 'Sí, está bien', {}), null)
})

test('focused quotes work for arbitrary units and categories without fabricating a shared floor or price', () => {
  const suites = [
    { id: 'x17', unit_number: '017', category: 'suite', bedrooms: 1, floor_number: 2, published_commercial_price: 145000 },
    { id: 'y29', unit_number: '029', category: 'suite', bedrooms: 1, floor_number: 3, published_commercial_price: 160000 },
  ]
  const input = info({ catalogo: suites, historial: [], property_context: {}, lead: {} })
  const quote = unitPriceQuote(input, 'Precio de las suites de un dormitorio', {})
  assert.match(quote.reply, /Las suites de 1 dormitorio son la 017 y la 029/)
  assert.match(quote.reply, /suite 017 es de \$145[.,]000.*suite 029 es de \$160[.,]000/)
  assert.doesNotMatch(quote.reply, /ubicad|planta|cada un/)
  assert.deepEqual(quote.followUp.candidate_ids, ['x17', 'y29'])
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, input, 'Precio de las suites de un dormitorio', quote), [])
  const equal = unitPriceQuote({ ...input, catalogo: suites.map(unit => ({ ...unit, published_commercial_price: 145000, floor_number: 2 })) }, 'Precio de las suites', {})
  assert.match(equal.reply, /ambas ubicadas en la planta 2/)
  assert.match(equal.reply, /USD cada una/)
  const unavailable = unitPriceQuote({ ...input, catalogo: suites.map(unit => unit.id === 'y29' ? { ...unit, status: 'vendido' } : unit) }, 'Precio de las suites', {})
  assert.equal(unavailable.followUp, undefined)
  assert.doesNotMatch(unavailable.reply, /029|160[.,]000/)
})

test('focused follow-up preserves published prices and does not change explicit single-unit or comparison questions', () => {
  for (const current of ['Precio del departamento 202', 'Precio del departamento 202 y del departamento 302', '¿Y en precio?']) {
    const quote = unitPriceQuote(info(), current, {})
    assert.equal(quote.followUp, undefined, current)
    assert.deepEqual(verifiedPriceReplyIssues(quote.reply, info(), current, quote), [], current)
  }
  const units = catalog.filter(unit => unit.category === 'departamento')
  const input = info({ catalogo: units, property_context: {}, historial: [], lead: {}, modo_comercial: 'preventa', politica_comercial: { precios_autorizados: true, precios_aproximados: false } })
  const quote = unitPriceQuote(input, 'Precio de los departamentos', {})
  assert.match(quote.reply, /departamentos de 2 y 3 dormitorios/)
  assert.match(quote.reply, /desde \$210[.,]000 hasta \$310[.,]000/)
  assert.doesNotMatch(quote.reply, /referencial|lanzamiento|sujeto/)
  assert.equal(quote.followUp.bedrooms, null)
  assert.deepEqual(verifiedPriceReplyIssues(quote.reply, input, 'Precio de los departamentos', quote), [])
})

test('plural price descriptions bind every unit and its shared bedrooms and floor to the quoted set', () => {
  const units = [
    { id: 'x902', unit_number: '902', category: 'penthouse', bedrooms: 3, floor_number: 9, published_commercial_price: 550000 },
    { id: 'x905', unit_number: '905', category: 'penthouse', bedrooms: 3, floor_number: 9, published_commercial_price: 550000 },
    { id: 'x901', unit_number: '901', category: 'penthouse', bedrooms: 2, floor_number: 9, published_commercial_price: 400000 },
  ]
  const query = { category: 'penthouse', operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } }
  const input = info({ catalogo: units, historial: [], property_context: { query }, referencia_unidad: { query, explicit: false } })
  const current = 'Precio de los penthouses', quote = unitPriceQuote(input, current, {})
  const suffix = ' Son valores referenciales de lanzamiento y pueden cambiar.'
  for (const reply of [
    quote.reply,
    'Los penthouses de tres dormitorios son el 902 y el 905, ambos en la planta 9, a $550.000 USD cada uno.' + suffix,
    'Los penthouses 902 y 905 tienen tres dormitorios. Ambos se encuentran en la planta 9 y cuestan $550.000 USD cada uno.' + suffix,
  ]) assert.deepEqual(verifiedPriceReplyIssues(reply, input, current, quote), [], reply)
  for (const [reply, issue] of [
    [quote.reply.replace('el 905', 'el 901'), 'price_unit_outside_query'],
    [quote.reply.replace('3 dormitorios', '2 dormitorios'), 'catalog_bedroom_mismatch'],
    [quote.reply.replace('planta 9', 'planta 8'), 'catalog_floor_mismatch'],
    ['Los penthouses 902 y 905 cuestan $550.000 USD cada uno. Ambos están ubicados en la planta 8.' + suffix, 'catalog_floor_mismatch'],
  ]) assert.ok(verifiedPriceReplyIssues(reply, input, current, quote).includes(issue), reply)
})

test('ordered plural price paraphrases retain unit-price relationships and reject a false common price', () => {
  const current = '¿Y en precio?', input = info(), quote = unitPriceQuote(input, current, {})
  const suffix = ' Son valores referenciales de lanzamiento y pueden cambiar.'
  for (const reply of [
    'Los departamentos 202 y 302 cuestan $250.000 USD y $270.000 USD, respectivamente.' + suffix,
    'El departamento 202 y el departamento 302 tienen precios de $250.000 USD y $270.000 USD, respectivamente.' + suffix,
  ]) assert.deepEqual(verifiedPriceReplyIssues(reply, input, current, quote), [], reply)
  for (const reply of [
    'Los departamentos 202 y 302 cuestan $270.000 USD y $250.000 USD, respectivamente.' + suffix,
    'Los departamentos 202 y 302 cuestan $250.000 USD cada uno. El 302 cuesta $270.000 USD.' + suffix,
    'Los departamentos 202 y 302 cuestan $250.000 USD y $270.000 USD, respectivamente. Ambos cuestan $250.000 USD.' + suffix,
  ]) assert.ok(verifiedPriceReplyIssues(reply, input, current, quote).includes('price_unit_mismatch'), reply)
  const labeled = { ...input, catalogo: catalog.map(unit => ({ ...unit, floor: 'Segunda Planta Alta' })) }
  const common = unitPriceQuote(labeled, 'Precio de los departamentos de 3 dormitorios', {})
  assert.deepEqual(verifiedPriceReplyIssues(common.reply, labeled, 'Precio de los departamentos de 3 dormitorios', common), [])
})

test('quoted relationships keep residential numbers separate from equally numbered local codes', () => {
  const units = [
    { id: 'suite005', unit_number: '005', category: 'suite', bedrooms: 1, published_commercial_price: 100000 },
    { id: 'local005', unit_number: 'LC-005', category: 'local', published_commercial_price: 70000 },
  ]
  const input = info({ catalogo: units, alcance_negocio: 'property', historial: [], lead: {}, property_context: {} })
  const quote = unitPriceQuote(input, 'Precio', {})
  const reply = 'La suite 005 cuesta $100.000 USD. El local LC-005 cuesta $70.000 USD. Son valores referenciales de lanzamiento y pueden cambiar.'
  assert.deepEqual(verifiedPriceReplyIssues(reply, input, 'Precio', quote), [])
  assert.ok(verifiedPriceReplyIssues(reply.replace('suite 005 cuesta $100.000', 'suite 005 cuesta $70.000'), input, 'Precio', quote).includes('price_unit_mismatch'))
})
