/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS test harness. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
require('./test-typescript.cjs')
const root = path.resolve(__dirname, '..')
const { withResponseReviewPolicy } = require('../src/lib/integrations/automation/response-review-policy.ts')
const approved = { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }

function load(file, mocks) {
  const filename = path.join(root, file), loaded = { exports: {} }
  const requireLocal = Module.createRequire(filename)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  new Function('require', 'module', 'exports', source)(id => Object.hasOwn(mocks, id) ? mocks[id] : requireLocal(id), loaded, loaded.exports)
  return loaded.exports
}

for (const enabled of [false, true]) test(`operational prose reaches ${enabled ? 'only the AI review' : 'delivery without review'} unchanged`, async () => {
  const calls = []
  // Each form previously triggered a numeric, link, protected-name or phrase gate.
  const draft = 'Su cita está confirmada para el quince de septiembre a las nueve. Puede revisar el crédito directo en https://example.com/orientacion.'
  const base = 'Banco Pichincha: revisaremos su solicitud pendiente el 15/09 a las 08:00. https://example.com/base'
  const { operationalReply } = load('src/lib/integrations/automation/operational-copy.ts', {})
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => operationalReply(base, 'Gracias', [], {
    protected_terms: ['Banco Pichincha'], link_contract: { required_links: ['https://example.com/base'] },
  }, async (_rules, input, _schema, _image, _file, _tone, task) => {
    calls.push(task)
    if (task === 'writing') return { mensaje: draft }
    assert.equal(input.borrador, draft)
    return approved
  }))
  assert.equal(result.reply, draft)
  assert.equal(result.generated, true)
  assert.deepEqual(calls, enabled ? ['writing', 'review'] : ['writing'])
})

test('operational observation reports only the AI verdict and never text-pattern observations', async () => {
  const { operationalReply } = load('src/lib/integrations/automation/operational-copy.ts', {})
  const draft = 'Su cita está confirmada a las nueve. https://example.com/otra'
  const result = await withResponseReviewPolicy({ enabled: false, observationOnly: true, updatedAt: null }, () =>
    operationalReply('La solicitud está pendiente a las 08:00.', 'Gracias', [], {},
      async (_rules, _input, _schema, _image, _file, _tone, task) => task === 'writing' ? { mensaje: draft } : approved))
  assert.equal(result.reply, draft)
  assert.equal(result.audit.observation.status, 'checked')
  assert.deepEqual(result.audit.final_validation.issues, [])
})

function commercialHarness(reply, review) {
  const calls = []
  const ai = { activePrompt: async name => name, draftReply: async () => { calls.push('writing'); return reply },
    aiJson: async (_rules, input) => { calls.push('review'); assert.equal(input.respuesta, reply); return review } }
  const { commercialReply } = load('src/lib/integrations/automation/sdr.ts', {
    './ai': ai,
    './catalog-embeddings': { retrieveCatalogByEmbeddings: async () => ({ units: null, audit: {} }) },
    './turn-answer': { turnAnswerFacts: () => ({ topics: ['financing'], facts: { financing: 'Texto automático que no debe añadirse.' } }),
      completeTurnAnswer: () => { throw Error('Code must not inspect or complete writer prose') } },
    './visit-location': { withVisitLocation: () => { throw Error('Code must not rewrite writer links') } },
  })
  return { calls, run: (info = {}) => commercialReply(info, 'Quiero algo comercial', {}, async () => {}) }
}

for (const mode of ['on', 'off', 'observation', 'deferred']) test(`commercial ${mode} preserves writer prose and bypasses completion gates`, async () => {
  const draft = 'Hola de nuevo. Le comparto los detalles de otra forma, por escrito. ¿Qué desea conocer?'
  const h = commercialHarness(draft, { aprobada: true, motivos: [], requiere_asesor: false })
  const result = await withResponseReviewPolicy({ enabled: mode !== 'off', observationOnly: mode === 'observation', updatedAt: null }, () =>
    h.run({ conversacion: { ya_saludamos: true }, ...(mode === 'deferred' ? { final_review_follows: true } : {}) }))
  assert.equal(result.reply, draft)
  assert.deepEqual(h.calls, mode === 'on' || mode === 'observation' ? ['writing', 'review'] : ['writing'])
})
