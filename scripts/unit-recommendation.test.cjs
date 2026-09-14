const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..'), originalLoad = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename)
const { unitRecommendation } = require('../src/lib/integrations/automation/unit-recommendation.ts')
const home = { id: '73b54291-5a35-4a20-8f34-85069cbf94c8', unit_number: '502', category: 'departamento', floor_number: 5, floor: 'Quinta Planta Alta', bedrooms: 3, area_internal_m2: 120.83 }
const twoRooms = { ...home, id: '1de40b7e-6d6a-4bc7-b898-e404b6510000', unit_number: '401', bedrooms: 2, floor_number: 4, floor: 'Cuarta Planta Alta' }
const suite = { ...home, id: 'cb053324-daa5-4188-9b3c-01ae77f144aa', unit_number: '210', category: 'suite', floor_number: 2, bedrooms: 1, floor: 'Segunda Planta Alta' }
const info = { catalogo: [home, twoRooms, suite], historial: [], lead: { preferred_bedrooms: null } }

test('three people and upper floors selects a real two-bedroom starting option without inventing suitability', () => {
  const result = unitRecommendation(info, 'me interesa una departamento para 3 personas en pisos altos')
  assert.match(result.reply, /Podemos empezar por el departamento 401, en cuarta planta alta/)
  assert.match(result.reply, /2 dormitorios.*120,83 m²/)
  assert.match(result.reply, /\/tour\/unidad\/1de40b7e/)
  assert.equal(result.audit.source, 'unit_recommendation')
  assert.deepEqual(result.audit.unit_reference.numbers, ['401'])
  assert.doesNotMatch(result.reply, /ideal|perfecto|adecuado|necesita|\$|USD|precio|3 dormitorios/)
  assert.equal(info.lead.preferred_bedrooms, null)
})

test('literal bedrooms and explicit floor narrow the candidate set independently from household size', () => {
  for (const current of ['Busco un departamento de 3 dormitorios', 'Quiero un departamento en el quinto piso', 'Me interesa un departamento en piso 5', 'Quiero un departamento para tres personas de tres dormitorios en pisos altos']) {
    assert.deepEqual(unitRecommendation(info, current).audit.unit_reference.numbers, ['502'], current)
  }
  const result = unitRecommendation(info, 'Quiero una suite de un dormitorio')
  assert.deepEqual(result.audit.unit_reference.numbers, ['210'])
  assert.match(result.reply, /segunda planta alta.*un dormitorio/)
  assert.match(result.reply, /segunda-planta.html\?unidad=210/)
})

test('specific questions, negation, explicit codes and unsupported constraints never become a recommendation', () => {
  for (const current of [
    'Quiero un departamento de 3 dormitorios y cuánto vale', 'Me interesa un departamento de tres dormitorios y una visita',
    'No quiero un departamento de tres dormitorios', 'Quiero el departamento 502', 'Quiero un departamento de 3 dormitorios en el piso 6',
    'Me interesa un departamento', 'Quiero un local en el piso 4', 'Quiero una suite de dos dormitorios',
    'Quiero un departamento de 2 o 3 dormitorios', 'Quiero un departamento de tres dormitorios, qué incluye?',
    'Quiero un departamento de tres dormitorios con financiamiento', 'Quiero rentar un departamento de tres dormitorios',
    'Busco un departamento de cuatro dormitorios en pisos altos', 'Quiero un departamento de tres dormitorios con piscina privada',
  ]) assert.equal(unitRecommendation(info, current), null, current)
})

test('unpublished and sold units are excluded and prior links are not resent unsolicited', () => {
  assert.equal(unitRecommendation({ catalogo: [{ ...home, is_published: false }, { ...home, status: 'vendido' }] }, 'Busco un departamento de tres dormitorios'), null)
  const result = unitRecommendation(info, 'Busco un departamento de tres dormitorios', { _unit_models_sent: [home.id] })
  assert.equal(result.audit.unit_model, undefined)
  assert.doesNotMatch(result.reply, /https:/)
})
