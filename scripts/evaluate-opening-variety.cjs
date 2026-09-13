// Read-only synthetic conversation. Calls the configured model, never sends a
// message to a lead, edits prices, or changes assignment. Explicit invocation:
// node scripts/evaluate-opening-variety.cjs --live
if (!process.argv.includes('--live')) throw Error('Use --live for billable model evaluation')
require('@next/env').loadEnvConfig(process.cwd())
require('./test-typescript.cjs')
const Module = require('node:module'), path = require('node:path'), assert = require('node:assert/strict')
const originalLoad = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(process.cwd(), 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
if (process.argv.includes('--debug')) {
  const ai = require('../src/lib/integrations/automation/ai.ts'), originalDraft = ai.draftReply, originalJson = ai.aiJson
  ai.draftReply = async (...args) => { const reply = await originalDraft(...args); console.log(JSON.stringify({ draft: reply })); return reply }
  ai.aiJson = async (...args) => { const result = await originalJson(...args); if (args[1]?.respuesta) console.log(JSON.stringify({ review: result })); return result }
}
const { commercialContext, commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { variedReplyOpening, replyOpening } = require('../src/lib/integrations/automation/response-openings.ts')
async function main() {
  const history = [{ role: 'bot', content: 'Claro, con mucho gusto. Podemos revisar lo que necesita.' }]
  const questions = ['Quisiera saber más sobre el proyecto.', 'Busco un departamento para vivir con mi familia.', '¿Qué hay cerca del edificio?', '¿Y qué medidas de seguridad tiene?']
  for (const current of process.argv.includes('--intro') ? questions.slice(0, 1) : questions) {
    const info = await commercialContext({ name: 'Prueba', preferred_category: 'departamento', purchase_purpose: 'vivir' }, history)
    const generated = await commercialReply(info, current, {}, async () => {})
    const reply = variedReplyOpening(generated.reply, history)
    assert.ok(reply && reply.length < 1500)
    assert.equal(replyOpening(reply), null, 'Do not repeat the recent generic courtesy')
    console.log(JSON.stringify({ question: current, reply, audit: generated.audit }))
    assert.doesNotMatch(reply, /información imprecisa|asesor le ayude a aclarar/, 'Known project information must not fall back to an unrelated handoff')
    history.push({ role: 'cliente', content: current }, { role: 'bot', content: reply })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
