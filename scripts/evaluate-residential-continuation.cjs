// Synthetic conversations, read-only catalogue and isolated model calls. No messages or CRM mutations.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
require('@next/env').loadEnvConfig(process.cwd())
const ai = require('../src/lib/integrations/automation/ai.ts')
const active = ai.activePrompt
ai.activePrompt = async name => ['respuesta_comercial', 'revisor_respuesta'].includes(name) ? fs.readFileSync('config/bot/' + name + '.txt', 'utf8') : active(name)
const { commercialContext, commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { residentialContinuationIssues } = require('../src/lib/integrations/automation/commercial-experience.ts')
const presentation = [{ role: 'cliente', content: 'Recomiéndeme un departamento' }, { role: 'bot', content: 'La Vilet cuenta con departamentos de 2 y 3 dormitorios en Puertas del Sol. La propuesta combina comodidad y tranquilidad. ¿Lo busca para vivir o invertir?' }]
const cases = [
  { name: 'purpose', current: 'Para vivir', history: presentation, verify: r => /2.*3|dos.*tres/.test(r.reply) && /dormitorio|habitacion/i.test(r.reply) && !r.needsAdvisor },
  { name: 'category_chosen', current: 'Para vivir', history: [{ role: 'bot', content: '¿Prefiere una suite o un departamento?' }, { role: 'cliente', content: 'Prefiero departamento' }, ...presentation.slice(1)], verify: r => !/suite/i.test(r.reply) && !r.needsAdvisor },
  { name: 'five_bedrooms', current: 'Quiero de 5', history: [...presentation, { role: 'cliente', content: 'Para vivir' }, { role: 'bot', content: 'Tenemos departamentos de 2 o 3 dormitorios. ¿Cuántos dormitorios le gustaría tener?' }], verify: r => /no contamos|no tenemos|no hay|no disponemos|no ofrece|no están disponibles|no están contemplad/i.test(r.reply) && /2.*3|dos.*tres/.test(r.reply) && !r.needsAdvisor },
  { name: 'local_after_suite', current: 'Tiene locales comerciales ??', history: [{ role: 'bot', content: 'Tenemos suites de un dormitorio.' }], category: 'local', verify: r => /locales comerciales/i.test(r.reply) && !r.needsAdvisor },
  { name: 'amenity_fee_unknown', current: 'O sea compro el departamento y eso ya asegura la piscina gimnasio o pago aparte mensual? No me quedó claro eso', history: [{ role: 'bot', content: 'El proyecto contempla piscina y gimnasio.' }], verify: r => r.needsAdvisor && !/no necesita.*(?:pagar|plan|membres)|no se cobra|sin.*(?:pago|cuota|membres)/i.test(r.reply) },
]
async function main() {
  const results = []
  const selected = process.argv.slice(2).length ? cases.filter(c => process.argv.slice(2).includes(c.name)) : cases
  for (let i = 0; i < selected.length; i += 2) {
    results.push(...await Promise.all(selected.slice(i, i + 2).map(async c => {
      const info = { ...await commercialContext({ name: 'Cliente de prueba', preferred_category: c.category || 'departamento', purchase_purpose: 'vivir', bot_enabled: true }, c.history), alcance_negocio: 'property', financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'] } }
      const draft = await commercialReply(info, c.current, {}, async () => {})
      const result = await completeTurnReply({ current: c.current, history: c.history, verified: info,
        baseReply: draft.audit.requires_advisor ? 'Ese detalle debe verificarlo nuestro equipo.' : draft.reply, audit: draft.audit })
      const passed = c.verify(result) && !residentialContinuationIssues(result.reply, c.current, info).length
      const report = { name: c.name, passed, reply: result.reply, needsAdvisor: result.needsAdvisor, draft, audit: result.audit }
      console.log(JSON.stringify(report));return report
    })))
  }
  fs.mkdirSync('tmp', { recursive: true })
  fs.writeFileSync('tmp/residential-continuation-eval.json', JSON.stringify(results, null, 2))
  if (results.some(r => !r.passed)) process.exitCode = 1
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
