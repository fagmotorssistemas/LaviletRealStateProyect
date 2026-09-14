// Synthetic messages only. This script calls OpenAI and never sends customer messages.
if (!process.argv.includes('--live')) {
  console.log('Use --live to evaluate five synthetic appointment/financing replies with the configured OpenAI model.')
  process.exit(0)
}
require('@next/env').loadEnvConfig(process.cwd())
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, f)
const { operationalReply } = require('../src/lib/integrations/automation/operational-copy.ts')
const cases = [
  { name: 'reschedule retains tomorrow and time', current: 'Para mañana a las ocho, ya le dije.',
    base: 'Revisaremos la disponibilidad para el martes 15 de septiembre a las 8 a. m. Le confirmaremos por aquí cuando el equipo revise ese horario.',
    context: { action: 'awaiting_advisor', preference: { day: '2026-09-15', time: '08:00' }, missing_fields: [] },
    verify: reply => { assert.match(reply, /15 de septiembre/); assert.match(reply, /8 a\. m\./); assert.doesNotMatch(reply, /\?|cita (?:está|queda) confirmada/) } },
  { name: 'customer asks for alternatives', current: 'Prefiero otra. ¿Qué opciones tiene?',
    base: 'He dejado su solicitud de otros horarios al asesor. El equipo revisará alternativas y se las compartiremos por aquí para que elija la que le convenga.',
    context: { action: 'advisor_alternatives_requested', missing_fields: [], scheduling_request_saved: true },
    verify: reply => { assert.doesNotMatch(reply, /\d|\?/); assert.match(reply, /horario|alternativa|opcion/i) } },
  { name: 'small budget gets financing accompaniment', current: 'Solo cuento con 100 dólares.',
    base: 'Podemos acompañarle a revisar opciones de financiamiento con Banco Pichincha o Cooperativa JEP. ¿Le gustaría explorar esa alternativa?',
    context: { action: 'offer_financing_information', qualification_started: false, explicit_consent: false },
    verify: reply => { assert.match(reply, /Banco Pichincha/); assert.match(reply, /Cooperativa JEP/); assert.doesNotMatch(reply, /aprobado|garantiz|crédito directo|\d/) } },
  { name: 'office explanation retains map and address', current: 'Sí, ¿en dónde están?',
    base: 'Nuestra oficina está en Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca, en la dirección donde se construirá La Vilet. Puede ver cómo llegar aquí: https://www.google.com/maps/search/?api=1&query=-2.892287,-79.030259',
    context: { action: 'share_office_location', phase: 'lanzamiento' },
    verify: reply => { assert.match(reply, /Ricardo Darquea Granda y Elena Landívar/); assert.match(reply, /https:\/\/www.google.com\/maps\/search\/\?api=1&query=-2.892287,-79.030259/); assert.doesNotMatch(reply, /\bdepartamentos terminados\b/) } },
  { name: 'one missing time instead of repeating the known day', current: 'Mañana me vendría bien.',
    base: 'Perfecto, revisaremos opciones para el martes 15 de septiembre. ¿A qué hora le gustaría venir?',
    context: { action: 'collecting', preference: { day: '2026-09-15', time: null }, missing_fields: ['time'] },
    verify: reply => { assert.match(reply, /15 de septiembre/); assert.match(reply, /hora/); assert.doesNotMatch(reply, /[Qq]ué día|[Cc]uándo|disponible/) } },
]
;(async () => {
  let generated = 0
  for (const c of cases) {
    const result = await operationalReply(c.base, c.current, [{ role: 'bot', content: 'Con gusto, revisamos esa opción.' }], c.context)
    c.verify(result.reply)
    if (result.generated) generated++
    console.log(JSON.stringify({ case: c.name, ...result }))
  }
  assert.ok(generated >= 3, `Expected at least three approved AI variants; got ${generated}`)
  console.log(JSON.stringify({ passed: cases.length, approved_ai_variants: generated }))
})().catch(error => { console.error(error.message); process.exitCode = 1 })
