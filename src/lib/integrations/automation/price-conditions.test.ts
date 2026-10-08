import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureReferentialPriceConditions, REFERENTIAL_PRICE_NOTICE } from './price-conditions'

const verified = { politica_comercial: { precios_autorizados: true, precios_aproximados: true },
  catalogo: [{ published_commercial_price: 250000 }, { published_commercial_price: 310000 }, { published_commercial_price: 539900 }] }

for (const quote of [
  'Los departamentos cuestan entre $250,000 y $310,000.',
  'Los precios de las unidades van desde USD 250.000 hasta USD 310.000.',
  'Puede conocer opciones desde 250000 USD.',
  'El departamento 202: $250,000.',
  'Tenemos departamentos entre 250 mil y 310 mil dólares.',
  'Las unidades están entre 250000 y 310000.',
]) test('referential-price qualifier for: ' + quote, () => {
  const question = '¿En qué planta le gustaría revisar las opciones?'
  const result = ensureReferentialPriceConditions(quote + '\n\n' + question, verified)
  assert.equal(result.applied, true)
  assert.ok(result.reply.includes(quote))
  assert.ok(result.reply.includes(REFERENTIAL_PRICE_NOTICE))
  assert.ok(result.reply.endsWith(question))
  assert.deepEqual(ensureReferentialPriceConditions(result.reply, verified), { reply: result.reply, applied: false })
})

for (const notice of [
  'Son los valores referenciales vigentes y pueden variar.',
  'Son valores referenciales y pueden cambiar.',
  'Son precios actuales de referencia sujetos a modificaciones.',
  'Son valores referenciales de lanzamiento y pueden variar.',
  'Es un precio referencial de lanzamiento y puede cambiar.',
  'Estos valores de lanzamiento son orientativos y están sujetos a modificaciones.',
  'Son precios de referencia en lanzamiento que podrán variar.',
  'Los precios aproximados de lanzamiento están sujetos a cambios.',
  'En lanzamiento estos valores son orientativos y podrían cambiar.',
]) test('preserves an equivalent complete condition: ' + notice, () => {
  const reply = 'Los departamentos cuestan $250,000. ' + notice
  assert.deepEqual(ensureReferentialPriceConditions(reply, verified), { reply, applied: false })
})

for (const reply of [
  'Su presupuesto es de $250,000. ¿Qué planta prefiere?',
  'La entrada para el departamento es de USD 250.000.',
  'Puede solicitar un crédito desde $250,000.',
  'La cuota del departamento puede ser de 250000 USD.',
  'Sus ingresos mensuales son USD 250.000.',
  'Disponemos de departamentos de 3 dormitorios en las plantas 2 a 5.',
  'Puede explorar el proyecto: https://example.test/tour/250000.',
  'No tenemos precios publicados para comunicar.',
]) test('does not attach price conditions to: ' + reply, () => {
  assert.deepEqual(ensureReferentialPriceConditions(reply, verified), { reply, applied: false })
})

test('both a declared budget and an actual quoted price retain their subjects', () => {
  const reply = 'Su presupuesto es de $400,000. El precio del penthouse es de $539,900. ¿Desea revisar alternativas?'
  const result = ensureReferentialPriceConditions(reply, verified)
  assert.equal(result.applied, true)
  assert.ok(result.reply.startsWith('Su presupuesto es de $400,000. El precio del penthouse es de $539,900.'))
  assert.ok(result.reply.endsWith('¿Desea revisar alternativas?'))
})

test('partial conditions are completed before the question without inventing figures', () => {
  const reply = 'Los departamentos cuestan $250,000; es un valor referencial. Para continuar, ¿qué planta prefiere?'
  const result = ensureReferentialPriceConditions(reply, verified)
  assert.equal(result.applied, true)
  assert.ok(result.reply.includes(REFERENTIAL_PRICE_NOTICE))
  assert.ok(result.reply.endsWith('¿qué planta prefiere?'))
})

for (const policy of [{ precios_aproximados: false }, {}, { precios_aproximados: true, precios_autorizados: false }])
  test('no unconfigured referential condition for ' + JSON.stringify(policy), () => {
    const reply = 'Los departamentos cuestan $250,000.'
    assert.deepEqual(ensureReferentialPriceConditions(reply, { ...verified, politica_comercial: policy }), { reply, applied: false })
  })

test('a budget comparison still qualifies the actual catalog price', () => {
  const reply = 'Con ese presupuesto, los penthouses parten de $539,900. ¿Desea revisar alternativas?'
  const result = ensureReferentialPriceConditions(reply, verified)
  assert.equal(result.applied, true)
  assert.ok(result.reply.includes(REFERENTIAL_PRICE_NOTICE))
})

test('the bridge remains adjacent to its question', () => {
  const bridge = 'Para orientarle mejor, ¿en qué planta le gustaría revisar opciones?'
  const reply = 'Los departamentos cuestan $250,000. ' + bridge
  const result = ensureReferentialPriceConditions(reply, verified)
  assert.ok(result.reply.endsWith(bridge))
  assert.ok(result.reply.indexOf(REFERENTIAL_PRICE_NOTICE) < result.reply.indexOf(bridge))
})

for (const stage of ['lanzamiento', 'preventa', 'venta']) test('commercial stage does not force a launch price condition: ' + stage, () => {
  const result = ensureReferentialPriceConditions('El departamento cuesta $250,000.', { ...verified, modo_comercial: stage })
  assert.equal(result.applied, true)
  assert.match(result.reply, /referenciales vigentes.*pueden cambiar/)
  assert.doesNotMatch(result.reply, /lanzamiento/)
  const exact = ensureReferentialPriceConditions('El departamento cuesta $250,000.', { ...verified, modo_comercial: stage,
    politica_comercial: { precios_aproximados: false, precios_autorizados: true } })
  assert.equal(exact.applied, false)
})

test('existing published commercial conditions remain intact when adding the generic price notice', () => {
  const reply = 'El departamento cuesta $250,000. El beneficio confirmado solo aplica hasta el 31 de octubre. ¿Desea revisar esta opción?'
  const result = ensureReferentialPriceConditions(reply, { ...verified,
    politicas_negocio: [{ policy_content: 'El beneficio confirmado solo aplica hasta el 31 de octubre.', scope: 'Departamento 202.' }] })
  assert.ok(result.reply.includes('El beneficio confirmado solo aplica hasta el 31 de octubre.'))
  assert.ok(result.reply.endsWith('¿Desea revisar esta opción?'))
  assert.ok(result.reply.includes(REFERENTIAL_PRICE_NOTICE))
})
