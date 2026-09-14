const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
let pageClient
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id === '@/lib/supabase/admin') return { tryCreateAdminClient: () => pageClient }
  if (id === 'next/navigation') return { notFound() { throw Error('NOT_FOUND') } }
  if (id === 'next/link') return { __esModule: true, default: props => React.createElement('a', props) }
  if (id.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) }
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText, filename)

const { unitModelUrl, unitReferenceUrl, UNIT_MODELS, UNIT_REFERENCE_PATH } = require('../src/lib/tour/unitModels.ts')
const { appendUnitModel, unitModelDelivery, unitModelRequestReply } = require('../src/lib/integrations/automation/unit-model.ts')
const { loadPublicUnitReference, unitReferenceSpecs } = require('../src/lib/tour/unitReference.ts')
const { LAVILET_TENANT_ID, LAVILET_PROJECT_ID } = require('../src/lib/integrations/lavilet.ts')
const { default: UnitPage } = require('../src/app/tour/unidad/[id]/page.tsx')
const unit502 = {
  id: '73b54291-5a35-4a20-8f34-85069cbf94c8', unit_number: '502', category: 'departamento',
  tenant_id: LAVILET_TENANT_ID, project_id: LAVILET_PROJECT_ID, is_published: true, status: 'disponible',
  floor: 'Quinta planta alta', floor_number: 5, bedrooms: 3, bathrooms_full: 2,
  area_internal_m2: 120.83, area_exterior_m2: 27.03, spaces: ['Sala', 'Cocina'],
  published_commercial_price: 310000, owner_phone: 'PRIVATE', description: 'INTERNAL NOTES',
}
const unit210 = { ...unit502, id: UNIT_MODELS.find(m => m.number === '210').id, unit_number: '210', category: 'suite', bedrooms: 1 }

function db(records, error = null) {
  const calls = []
  const client = { from(table) {
    calls.push(['from', table]); const filters = []; let fields = []
    const query = {
      select(value) { fields = value.split(','); calls.push(['select', value]); return query },
      eq(key, value) { filters.push(row => row[key] === value); calls.push(['eq', key, value]); return query },
      in(key, values) { filters.push(row => values.includes(row[key])); calls.push(['in', key, values]); return query },
      abortSignal() { return query },
      async maybeSingle() {
        const record = records.find(row => filters.every(filter => filter(row)))
        return { error, data: record ? Object.fromEntries(fields.map(field => [field, record[field] ?? null])) : null }
      },
    }
    return query
  } }
  return { client, calls }
}

test('all published homes get a reference while existing geometry still points to its exact model', () => {
  assert.equal(unitModelUrl(unit502), null)
  assert.equal(unitReferenceUrl(unit502), `https://www.lavilett.com${UNIT_REFERENCE_PATH}/${unit502.id}`)
  assert.equal(unitReferenceUrl(unit210), 'https://www.lavilett.com/tour/modelo-3d/segunda-planta.html?unidad=210')
  for (const change of [{ is_published: false }, { status: 'vendido' }, { category: 'local' }, { id: '../../other' }, { unit_number: '<script>' }]) {
    assert.equal(unitReferenceUrl({ ...unit502, ...change }), null)
  }
})

test('delivery distinguishes an available 3D model from a pending model and remembers either reference', () => {
  const reference = { explicit: true, matches: [unit502] }
  const delivery = unitModelDelivery(reference, 'Me interesa el departamento 502', [])
  assert.equal(delivery.model_available, false)
  assert.match(delivery.caption, /ficha del departamento 502/)
  assert.match(delivery.caption, /modelo específico.*pendiente/)
  assert.doesNotMatch(delivery.caption, /explorar.*502 en 3D/)
  assert.equal(unitModelDelivery(reference, 'Qué ofrece el departamento 502', [{ role: 'bot', content: delivery.caption }]), null)
  assert.equal(unitModelDelivery(reference, 'Me interesa el departamento 502', [], [unit502.id]), null)
  assert.equal(unitModelDelivery(reference, 'No me envíe el modelo del departamento 502', []), null)
  assert.equal(unitModelDelivery(reference, 'Envíeme otra vez la foto del departamento 502', [{ role: 'bot', content: delivery.caption }]).url, delivery.url)
  assert.match(unitModelRequestReply([unit502], 'Me interesa el departamento 502', true), /3 dormitorios.*120,83 m²/)
  assert.doesNotMatch(unitModelRequestReply([unit502], 'Envíeme una foto', true), /girar el modelo/)
  assert.equal(unitModelDelivery({ explicit: true, matches: [unit210] }, 'Suite 210', []).model_available, true)
})

test('oversized replies always preserve the complete reference and remove whole trailing sentences', () => {
  const delivery = unitModelDelivery({ explicit: true, matches: [unit502] }, 'Me interesa el departamento 502', [])
  const price = 'El precio aproximado es de $310.000 USD y puede cambiar durante el lanzamiento.'
  const detail = 'La vivienda cuenta con tres dormitorios y 120,83 m² interiores para disfrutar en familia.'
  const last = 'Puede consultar el horario del 14/09/2026 a las 10:30 en su conversación.'
  const draft = `${price}\n\n${Array(18).fill(detail).join(' ')} ${last}`
  assert.ok(draft.length > 1400)
  const reply = appendUnitModel(draft, delivery)
  assert.ok(reply.length <= 1400)
  assert.ok(reply.startsWith(price))
  assert.ok(reply.endsWith(delivery.caption))
  const body = reply.slice(0, -delivery.caption.length).trim()
  assert.ok(body.endsWith(detail))
  assert.doesNotMatch(body, /14\/09|10:30/)
  assert.equal(reply.split(delivery.url).length - 1, 1)
})

test('an indivisible oversized sentence yields the complete caption; repeated URLs and send offers are removed', () => {
  const delivery = unitModelDelivery({ explicit: true, matches: [unit210] }, 'Suite 210', [])
  assert.equal(appendUnitModel('x'.repeat(1800), delivery), delivery.caption)
  const existing = `${'Una descripción extensa de esta vivienda. '.repeat(50)}\n\n${delivery.caption}`
  const compacted = appendUnitModel(existing, delivery)
  assert.ok(compacted.length <= 1400)
  assert.equal(compacted.split(delivery.url).length - 1, 1)
  assert.ok(compacted.endsWith(delivery.caption))
  const priceWithLink = `El precio es de $250.000 USD; explore la unidad aquí: ${delivery.url}`
  const firstLink = appendUnitModel(`${priceWithLink}\n\n${'Más detalles de la vivienda. '.repeat(60)}`, delivery)
  assert.ok(firstLink.length <= 1400)
  assert.ok(firstLink.startsWith(priceWithLink))
  assert.equal(firstLink.split(delivery.url).length - 1, 1)
  const immediate = appendUnitModel('Tiene un dormitorio. Si gusta, puedo enviarle el modelo. ¿Le gustaría que le comparta el enlace?', delivery)
  assert.match(immediate, /Tiene un dormitorio/)
  assert.doesNotMatch(immediate, /gustaría|puedo enviarle/)
  assert.ok(immediate.endsWith(delivery.caption))
  assert.equal(appendUnitModel('Sin modelo.', null), 'Sin modelo.')
})

test('public reference query excludes private, sold, foreign-project and commercial records and never returns internal prices', async () => {
  const storage = db([unit502])
  const unit = await loadPublicUnitReference(storage.client, unit502.id)
  assert.equal(unit.unit_number, '502')
  assert.equal(unit.published_commercial_price, undefined)
  assert.equal(unit.owner_phone, undefined)
  assert.equal(unit.description, undefined)
  for (const changed of [{ is_published: false }, { status: 'vendido' }, { project_id: 'another' }, { tenant_id: 'another' }, { category: 'local' }]) {
    assert.equal(await loadPublicUnitReference(db([{ ...unit502, ...changed }]).client, unit502.id), null)
  }
  const invalid = db([unit502])
  assert.equal(await loadPublicUnitReference(invalid.client, '<script>'), null)
  assert.equal(invalid.calls.length, 0)
  await assert.rejects(loadPublicUnitReference(db([], { message: 'PRIVATE_DATABASE_ERROR' }).client, unit502.id), /PUBLIC_UNIT_REFERENCE_UNAVAILABLE/)
})

test('unit page preserves selected home, gives its real specs and clearly labels the different example', async () => {
  pageClient = db([unit502]).client
  const html = renderToStaticMarkup(await UnitPage({ params: Promise.resolve({ id: unit502.id }) }))
  assert.match(html, /id="unit-title">Departamento 502/)
  assert.match(html, /120,83 m²/)
  assert.match(html, /modelo 3D del departamento 502 aún está pendiente/)
  assert.match(html, /suite 210, en la segunda planta/)
  assert.match(html, /distintas a las del departamento 502/)
  assert.match(html, /<details[^>]*><summary>Explorar un ejemplo/)
  assert.match(html, /title="Ejemplo del proyecto: modelo 3D de la suite 210"/)
  assert.doesNotMatch(html, /PRIVATE|INTERNAL NOTES|310000/)
  assert.match(html, /brochure-la-vilet-v5.pdf/)
})

test('same stable reference displays its exact model when one exists; unavailable records never show a substituted unit', async () => {
  pageClient = db([unit210]).client
  const html = renderToStaticMarkup(await UnitPage({ params: Promise.resolve({ id: unit210.id }) }))
  assert.match(html, /title="Modelo 3D de Suite 210"/)
  assert.doesNotMatch(html, /pendiente|distintas/)
  pageClient = db([]).client
  await assert.rejects(UnitPage({ params: Promise.resolve({ id: unit502.id }) }), /NOT_FOUND/)
  pageClient = db([], { message: 'DO_NOT_LEAK' }).client
  const unavailable = renderToStaticMarkup(await UnitPage({ params: Promise.resolve({ id: unit502.id }) }))
  assert.match(unavailable, /no se pudo cargar/)
  assert.doesNotMatch(unavailable, /DO_NOT_LEAK|<iframe/)
})

test('empty specs do not fabricate areas or bedrooms', () => {
  assert.deepEqual(unitReferenceSpecs({ ...unit502, bedrooms: null, bathrooms_full: 0, area_internal_m2: null, area_exterior_m2: null, floor: null, floor_number: null }), [])
})
