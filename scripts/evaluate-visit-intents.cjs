/* eslint-disable @typescript-eslint/no-require-imports -- El evaluador carga TypeScript con el cargador CommonJS de pruebas. */
// Evaluación de IA con datos sintéticos. No importa ejecutores, no escribe en Supabase ni envía mensajes.
// Ejecutar explícitamente: node scripts/evaluate-visit-intents.cjs (consume API de OpenAI).
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const assert = require('node:assert/strict'), root = path.resolve(__dirname, '..')
require('@next/env').loadEnvConfig(root)
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, file)
const { aiJson } = require('../src/lib/integrations/automation/ai.ts')
// Leer el prompt literal evita importar el ejecutor o Kommo en esta evaluación.
const source = fs.readFileSync(path.join(root, 'src/lib/integrations/automation/conversation.ts'), 'utf8')
const prompt = source.match(/export const visitIntentPrompt = `([\s\S]*?)`/)[1]
const cases = [
  ['no puedo a esa hora, mejor a las 3', 'awaiting_client', 'counterproposal'],
  ['Quiero cancelar mi cita\nBueno mejor quiero reagendar para hoy', 'awaiting_advisor', 'counterproposal'],
  ['Perdón, no voy a poder asistir a la cita', 'confirmed', 'cancel'],
  ['No puedo a esa hora', 'awaiting_client', 'reject'],
  ['Perfecto, muchas gracias', 'awaiting_advisor', 'question'],
  ['Está bien', 'awaiting_client', 'accept'],
  ['Sí, pero ¿podría ser mañana?', 'awaiting_client', 'counterproposal'],
  ['Buenos días, quiero agendar una cita', null, 'question'],
]
async function main() {
  let passed = 0
  for (const [message, status, expected] of cases) {
    const proposal = status && { status, proposed_start_time: '2026-09-11T18:00:00Z', proposed_end_time: '2026-09-11T19:00:00Z',
      mensaje_propuesta: 'Podemos recibirle el viernes 11 de septiembre a la 1 p. m. ¿Le queda bien o prefiere otro horario?' }
    const output = await aiJson(prompt, { mensaje_cliente: message, propuesta: proposal, historial: [
      { role: 'cliente', content: 'Quiero visitar el proyecto mañana' },
      { role: 'bot', content: status === 'awaiting_client' ? proposal.mensaje_propuesta : 'Revisaremos el horario que solicita.' },
    ] })
    assert.equal(output.intent, expected, message)
    passed++
    console.log(JSON.stringify({ message, intent: output.intent, result: 'PASS' }))
  }
  console.log(JSON.stringify({ passed, total: cases.length, sends: 0, databaseWrites: 0 }))
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
