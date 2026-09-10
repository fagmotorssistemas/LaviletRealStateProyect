// Read-only catalogue + synthetic conversations. Never imports Kommo or writes to Supabase.
// Makes billable OpenAI calls when run explicitly: node scripts/evaluate-sdr.cjs
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
require('@next/env').loadEnvConfig(root)
const prompt = name => fs.readFileSync(path.join(root, 'docs/prompts', name + '.md'), 'utf8').trim()
const originalLoad = Module._load
let candidatePromptReads = 0
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  if (id === './ai' && /[\\/]automation[\\/]sdr\.ts$/.test(parent?.filename || '')) {
    return { ...originalLoad.call(this, id, parent, main), activePrompt: async name => { candidatePromptReads++; return prompt(name) } }
  }
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename)
const { aiJson } = require('../src/lib/integrations/automation/ai.ts')
const { commercialContext, commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { normalizeEvents } = require('../src/lib/integrations/automation/conversation-rules.ts')
const { sdrState, qualifiedFacts, nextDiscoveryQuestion, isGreetingOnly, styleIssues } = require('../src/lib/integrations/automation/sdr-rules.ts')
const folder = path.join(root, 'tmp/sdr-review')
fs.mkdirSync(folder, { recursive: true })
const transcript = process.argv.includes('--resume') ? JSON.parse(fs.readFileSync(path.join(folder, 'evaluation.json'), 'utf8')) : []
async function runConversation(name, messages) {
  let lead = { name: 'Cliente de prueba' }, history = [], summary = {}
  const completed = transcript.filter(row => row.scenario === name)
  for (const row of completed) {
    const e = row.extracted
    if (e.preferred_category) lead.preferred_category = e.preferred_category
    if (e.purchase_purpose) lead.purchase_purpose = e.purchase_purpose
    lead.behavior_signals = { sdr: { ...lead.behavior_signals?.sdr, ...qualifiedFacts(e.qualification || {}, row.current) } }
    history.push({ role: 'cliente', content: row.current }, { role: 'bot', content: row.reply })
    summary = row.summary || summary
  }
  if (completed.length === messages.length) return
  const catalogContext = await commercialContext(lead, [])
  for (const current of messages.slice(completed.length)) {
    const started = Date.now()
    let reply, audit = {}, extracted = {}
    const greeting = isGreetingOnly(current)
    if (greeting && !sdrState(lead, history).ya_saludamos) reply = prompt('saludo_inicial')
    else {
      if (!greeting) {
        summary = await aiJson(prompt('resumen_conversacion'), { historial: history, resumen_anterior: summary, mensaje_actual: current })
        extracted = normalizeEvents(await aiJson(prompt('extractor_eventos'), { resumen: summary, mensaje_actual: current }), current)
        if (extracted.preferred_category) lead.preferred_category = extracted.preferred_category
        if (extracted.purchase_purpose) lead.purchase_purpose = extracted.purchase_purpose
        lead.behavior_signals = { sdr: { ...lead.behavior_signals?.sdr, ...qualifiedFacts(extracted.qualification, current) } }
      }
      if (extracted.opt_out) reply = '[Ruta de baja; no genera respuesta comercial]'
      else if (extracted.requested_advisor) reply = '[Ruta de atención humana; no confirma llamadas]'
      else if (extracted.events?.includes('requested_visit')) reply = extracted.preferred_visit_time_text
        ? '[Ruta de solicitud de visita; requiere guardar antes de responder]'
        : 'Con gusto coordinamos una visita a La Vilet. ¿Qué día y horario le vendrían bien?'
      else {
        const generated = await commercialReply({ ...catalogContext, lead, historial: history, conversacion: sdrState(lead, history), siguiente_pregunta: nextDiscoveryQuestion(lead) }, current, summary, async () => {})
        assert.ok(candidatePromptReads > 0, 'Must use candidate prompts from docs/prompts')
        reply = generated.reply; audit = generated.audit
      }
    }
    assert.deepEqual(styleIssues(reply, sdrState(lead, history).ya_saludamos), [], name + ': style')
    assert.equal(audit.fallback === true, false, name + ': rejected twice')
    assert.doesNotMatch(reply, /\$\s*[\d]|agendad[oa]|cita (está )?confirmada/i)
    if (/algo comercial/.test(current)) assert.equal(lead.preferred_category, 'local')
    if (/cafetería/.test(current)) assert.equal(lead.purchase_purpose, 'negocio')
    if (/60 metros/.test(current)) { assert.ok(lead.behavior_signals.sdr.area_buscada); assert.equal(extracted.preferred_category, null) }
    if (/Dos dormitorios/.test(current)) assert.ok(lead.behavior_signals.sdr.prioridad)
    if (/120 mil/.test(current)) assert.equal(extracted.monthly_income, null)
    if (/Mañana a las diez/.test(current)) assert.ok(extracted.events.includes('requested_visit'))
    if (/llamarme/.test(current)) assert.equal(extracted.requested_advisor, true)
    if (/No me escriban/.test(current)) assert.equal(extracted.opt_out, true)
    const row = { scenario: name, current, reply, extracted, summary, audit, elapsed_ms: Date.now() - started }
    transcript.push(row)
    fs.writeFileSync(path.join(folder, 'evaluation.json'), JSON.stringify(transcript, null, 2))
    console.log(JSON.stringify({ scenario: name, current, reply, audit, elapsed_ms: row.elapsed_ms }))
    history.push({ role: 'cliente', content: current }, { role: 'bot', content: reply })
  }
}
async function main() {
  await runConversation('local', ['Hola', 'Buenas tardes', 'Quiero algo comercial', 'Para poner una cafetería', 'Unos 60 metros', 'Hasta 120 mil', 'Quiero ir a verlo', 'Mañana a las diez'])
  await runConversation('vivienda', ['Hola, ¿cuánto cuesta un departamento?', 'Para vivir con mi esposa', 'Dos dormitorios y una terraza', '¿Dónde están ubicados?'])
  await runConversation('llamada', ['¿Pueden llamarme mañana a las diez?'])
  await runConversation('baja', ['No me escriban más'])
  console.log('PASS: ' + transcript.length + ' synthetic turns; no messages sent; no database writes.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
