/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic prompts only. No CRM writes, personal data, sends, or scheduling actions.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
require('@next/env').loadEnvConfig(path.join(__dirname, '..'))
const { completeTurnReply } = require('../src/lib/integrations/automation/turn-completeness.ts')
const { aiJson } = require('../src/lib/integrations/automation/ai.ts')
const { houseProductReply } = require('../src/lib/integrations/automation/product-fit.ts')
const { financingQuestionReply } = require('../src/lib/integrations/automation/financing.ts')
const verified = { project: 'La Vilet', city: 'Cuenca', products: ['suites', 'departamentos', 'locales comerciales'], houses: false, direct_credit: false,
  financing_partners: ['Banco Pichincha', 'Cooperativa JEP'], launch_prices_reference: true,
  housing_range: '$210.000 a $550.000', offices_and_project_same_address: true,
  units: [{ code: '202', type: 'departamento', price: 250000, balcony: true }], rental_income_acceptance_policy: null }
const cases = [
  { name: 'three_requests', current: 'Entiendo y qué opciones tienen? A mí me gustaría comprar algo pero no sé si me alcanza\nCuál es el valor de los departamentos?', baseReply: 'Podemos comparar departamentos de 2 o 3 dormitorios para ver cuál se adapta a lo que busca.',
    verify: r => /210\.000|550\.000/.test(r.reply) && /Pichincha|JEP/.test(r.reply) && r.audit.requests?.length >= 3 },
  { name: 'house_and_credit', current: 'Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?', baseReply: 'No ofrecemos crédito directo. Podemos revisar opciones con Banco Pichincha o Cooperativa JEP.',
    verify: r => (/no (?:ofrecemos|vendemos|tenemos|hay) casas|no disponemos de casas|no casas|no de casas|no comercializa casas/i.test(r.reply) && /crédito directo/.test(r.reply) && r.audit.requests?.length >= 3)
      || (r.needsAdvisor && /crédito directo/.test(r.reply) && r.unresolved.some(v => /casa/.test(v))) },
  { name: 'ambiguous_options', current: 'Qué opciones tengo?', history: [{ role: 'bot', content: 'No ofrecemos crédito directo. Podemos revisar opciones con Banco Pichincha o Cooperativa JEP.' }], baseReply: 'No ofrecemos crédito directo.',
    verify: r => !r.needsAdvisor && /Pichincha|JEP/.test(r.reply) },
  { name: 'rental_purpose', current: 'Sí ayúdeme en el financiamiento. Y el local lo quiero para rentarlo, eso influye en algo?', baseReply: 'Podemos revisar opciones con Banco Pichincha o Cooperativa JEP. ¿Con cuál entidad desea continuar?', preserveOperationalQuestion: true,
    verify: r => !/rentarlo respalda|porque genera ingresos/.test(r.reply) && /\?/.test(r.reply) },
  { name: 'false_rental_base', current: 'Sí ayúdeme en el financiamiento. Y el local lo quiero para rentarlo, eso influye en algo?', baseReply: 'Podemos revisar opciones con Banco Pichincha o Cooperativa JEP. El hecho de que planee rentarlo respalda la solicitud porque genera ingresos. ¿Con cuál entidad desea continuar?', preserveOperationalQuestion: true,
    verify: r => !/rentarlo respalda|porque genera ingresos/.test(r.reply) && /\?/.test(r.reply) && r.needsAdvisor },
  { name: 'unknown_acoustic_fact', current: 'Cuánto vale el departamento 202? Tiene certificación acústica?', baseReply: 'El valor referencial de lanzamiento del departamento 202 es $250.000.',
    verify: r => r.needsAdvisor && /250\.000/.test(r.reply) && r.unresolved.some(v => /certificaci/.test(v)) },
  { name: 'no_filler_question', current: 'Gracias, eso era lo que necesitaba.', baseReply: 'Con gusto. ¿Prefiere un departamento para vivir o invertir?',
    verify: r => !r.reply.includes('?') && !r.needsAdvisor },
  { name: 'house_pipeline', current: 'Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?',
    baseReply: [houseProductReply('Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?'), financingQuestionReply('Quiero una casa de 300 mil, cuántos pisos tiene la casa? Y tienen crédito directo?', ['Banco Pichincha', 'Cooperativa JEP'])].join(' '),
    verify: r => /no (?:vendemos|ofrecemos) casas|no disponemos de casas|no son casas/.test(r.reply) && /pisos/.test(r.reply) && /crédito directo/.test(r.reply) && !r.needsAdvisor },
]

async function main() {
  const results = []
  const names = process.argv.slice(2)
  const selected = names.length ? cases.filter(item => names.includes(item.name)) : cases
  // Keep provider concurrency bounded; each helper makes at most two calls.
  for (let index = 0; index < selected.length; index += 2) {
    const batch = await Promise.all(selected.slice(index, index + 2).map(async item => {
      const raw = []
      const result = await completeTurnReply({ ...item, verified }, async (...args) => { const result = await aiJson(...args); raw.push(result); return result })
      const passed = item.verify(result)
      console.log(JSON.stringify({ name: item.name, passed, status: result.audit.status, changed: result.changed, needsAdvisor: result.needsAdvisor, reply: result.reply, unresolved: result.unresolved, question: result.audit.question }))
      return { name: item.name, passed, ...result, raw }
    }))
    results.push(...batch)
  }
  fs.mkdirSync(path.join(__dirname, '../tmp'), { recursive: true })
  fs.writeFileSync(path.join(__dirname, '../tmp/turn-completeness-eval' + (names.length ? '-selected' : '') + '.json'), JSON.stringify(results, null, 2))
  if (results.some(result => !result.passed)) process.exitCode = 1
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
