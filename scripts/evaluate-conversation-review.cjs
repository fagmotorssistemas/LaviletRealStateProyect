// Synthetic OpenAI evaluations. No database mutations and no Kommo/WhatsApp sends.
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
const ai = require('../src/lib/integrations/automation/ai.ts')
const prompt = name => fs.readFileSync(path.join(root, 'docs/prompts/'+name+'.md'), 'utf8')
const filename = path.join(root, 'src/lib/integrations/automation/sdr.ts')
const moduleCopy = { exports: {} }
new Function('require','module','exports', ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(id => id === './ai' ? { ...ai, activePrompt: async name => prompt(name) } : Module.createRequire(filename)(id), moduleCopy, moduleCopy.exports)
const { commercialReply } = moduleCopy.exports
const tests = [
  { name: 'presupuesto incierto', message: 'No estoy seguro de mi presupuesto', history: '¿Tiene un presupuesto aproximado?',
    check: text => { assert.match(text, /financi|entrada|cuota|orientar|ayudar/i); assert.doesNotMatch(text, /visita presencial|tamaño aproximado/i) } },
  { name: 'ubicación del edificio', message: 'La ubicación del edificio', history: '¿Qué sería más importante al elegir?',
    check: text => { assert.match(text, /Puertas del Sol|Ricardo|Cuenca/); assert.doesNotMatch(text, /segundo al sexto|ubicación dentro|pisos atractivos/i) } },
  { name: 'atributos sin generalizar', message: '¿Todos los departamentos tienen balcón y terraza para Airbnb?', history: 'Podemos revisar los departamentos.',
    check: text => { assert.doesNotMatch(text, /no todos.*(?:tienen|incluyen|cuentan)|(?:el |departamento )301 no (?:tiene|incluye|cuenta|lo incluye)|rentabilidad garantizada|permitido.*Airbnb/i); assert.match(text, /unidad|opci[oó]n|verificar|revisar|confirmar/i) } },
]
async function main() {
  for (const t of tests) {
    const generated = await commercialReply({
      mensaje_actual: t.message, historial: [{ role: 'bot', content: t.history }],
      conversacion: { ya_saludamos: true, datos_conocidos: { categoria: 'departamento', proposito: 'vivir' } },
      proyecto: { name: 'La Vilet', address: 'Ricardo Darquea Granda y Elena Landívar, Puertas del Sol, Cuenca' },
      politica_comercial: { precios_autorizados: false, confirmar_visita_sin_resultado: false },
      catalogo: [{ unit_number: '202', bedrooms: 3, spaces: ['sala', 'cocina', 'balcón'] }, { unit_number: '301', bedrooms: 2, spaces: ['sala', 'cocina'] }],
      instalaciones: [], fecha: 'jueves 10 de septiembre de 2026, 17:45, Ecuador',
      siguiente_pregunta: { question: '¿Le gustaría que el equipo le ayude a revisar su consulta?' },
    }, t.message, {}, async () => {})
    const result = generated.reply
    assert.equal(generated.audit.fallback, false, 'El caso debe resolverse sin recurrir a una pregunta genérica')
    assert.doesNotMatch(result, /amenidades|gracias por (?:comentarlo|aclararlo)|buenas noches/i)
    assert.ok((result.match(/La Vilet/g) || []).length <= 1)
    t.check(result); console.log(JSON.stringify({ case: t.name, reply: result, result: 'PASS' }))
  }
  for (const t of [
    { message: 'si claro', previous: 'Podemos orientarle con Banco Pichincha. ¿Le gustaría que iniciemos una revisión de financiamiento?', check: r => assert.equal(r.financing_consent, true) },
    { message: 'Con jardín azuayo', previous: '¿Con cuál entidad le gustaría realizar la revisión?', check: r => assert.match(r.financing_partner, /jard[ií]n azuayo/i) },
    { message: 'no estoy seguro, pero en la tarde', previous: '¿Qué día y hora le gustaría venir?', check: r => { assert.equal(r.visit_needs_help, true); assert.ok(r.events.includes('requested_visit')); assert.equal(r.requested_advisor, false) } },
  ]) {
    const result = await ai.aiJson(prompt('extractor_eventos'), { mensaje_actual: t.message, ultima_pregunta: t.previous,
      historial: [{ role: 'bot', content: t.previous }], coordinacion_visita: { status: 'collecting' }, financiamiento: { partners: ['Banco Pichincha'] } })
    t.check(result); console.log(JSON.stringify({ case: t.message, result: 'PASS' }))
  }
  console.log(JSON.stringify({ passed: 6, databaseWrites: 0, sends: 0 }))
}
main().catch(e => { console.error(e.message); process.exitCode = 1 })
