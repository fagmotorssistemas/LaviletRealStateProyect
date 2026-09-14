// Synthetic conversations; read-only catalog access and OpenAI generation.
// Never calls financial/appointment writes or sends messages to Kommo.
if (!process.argv.includes('--live')) { console.log('Use --live to evaluate multi-question replies with the current catalog and local prompts.'); process.exit(0) }
require('@next/env').loadEnvConfig(process.cwd())
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), original = Module._load
Module._load = function(id,parent,main) { if(id==='server-only') return {}; if(id.startsWith('@/')) id=path.join(root,'src',id.slice(2)); return original.call(this,id,parent,main) }
require('./test-typescript.cjs')
const ai = require('../src/lib/integrations/automation/ai.ts')
ai.activePrompt = async name => fs.readFileSync(path.join(root,'config/bot',name+'.txt'),'utf8')
const { commercialContext, commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { financingContext, financingQuestionReply, financingInputs, financingReply } = require('../src/lib/integrations/automation/financing.ts')
const { operationalReply } = require('../src/lib/integrations/automation/operational-copy.ts')
const { completeTurnAnswer, turnAnswerFacts } = require('../src/lib/integrations/automation/turn-answer.ts')
const { missingCommercialTopics } = require('../src/lib/integrations/automation/multi-topic-turn.ts')
const { locationAnswer } = require('../src/lib/integrations/automation/visit-location.ts')
async function main() {
  const history = [{role:'cliente',content:'Busco una vivienda en La Vilet.'},{role:'bot',content:'Contamos con suites, departamentos y locales comerciales.'}]
  const lead = {id:'00000000-0000-0000-0000-000000000000',preferred_category:null}
  const info = {...await commercialContext(lead,history), financiamiento:await financingContext(lead), alcance_negocio:'property',politica_visitas:{allowSuggestions:false,launchDestination:'office'}}
  const results = []
  for(const current of [
    'Entiendo y que opciones tiene? A mi me gustaría compra algo pero no sé si me alcanza\nCuál ese el valor de los departamentos?',
    'Qué opciones tiene? Me gustaría comprar algo, pero no sé si me alcanza.',
    'Cuál es el precio del departamento 502? No necesito financiamiento.',
  ]) {
    const result = await commercialReply(info,current,{},async()=>{})
    assert.notEqual(result.audit.requires_advisor,true)
    const copy = await operationalReply(result.reply,current,history,result.audit)
    assert.deepEqual(missingCommercialTopics(copy.reply,turnAnswerFacts(info,current).topics),[])
    if(/alcanza/.test(current)) {assert.match(copy.reply,/Banco Pichincha/);assert.match(copy.reply,/Cooperativa JEP/)}
    assert.doesNotMatch(copy.reply,/Mapa:|maps\/|precios? registrad/i)
    if(/No necesito/.test(current)) assert.doesNotMatch(copy.reply,/financiamiento|Pichincha|JEP/)
    results.push({current,...copy,audit:result.audit})
    console.log(JSON.stringify(results.at(-1)))
  }
  const current = 'Esa ubicación de que es? Además tengo dos vehículos, y cómo funciona el financiamiento, qué necesito para saber si soy elegible?\nY tienen crédito directo?'
  const base = financingQuestionReply(current,info.financiamiento.partners)
  const complete = completeTurnAnswer(base,turnAnswerFacts(info,current))
  assert.deepEqual(complete.missing,[])
  const copy = await operationalReply(complete.reply,current,history,{source:'financing_question'})
  assert.match(copy.reply,/estacionamientos/i);assert.match(copy.reply,/ingresos/);assert.match(copy.reply,/oficina/)
  assert.ok(copy.reply.includes(info.proyecto.address));assert.ok(copy.reply.includes(info.ubicacion))
  assert.match(copy.reply,/no ofrecemos crédito directo|no (?:tenemos|contamos con|damos) crédito directo/i)
  results.push({current,...copy});console.log(JSON.stringify(results.at(-1)))
  const offer='Podemos revisar su financiamiento con Cooperativa JEP. ¿Le gustaría iniciar la revisión?'
  const consent = financingInputs({},'sí, quisiera hacer la prueba conb la cooperativa jep',offer,info.financiamiento)
  assert.equal(consent.consent,true);assert.equal(consent.partner,'Cooperativa JEP')
  const financeBase = 'Continuamos con Cooperativa JEP. '+financingReply({state:'identificacion_pendiente'},info.financiamiento.partners)
  const accepted = await operationalReply(financeBase,'sí, quisiera hacer la prueba conb la cooperativa jep',[{role:'bot',content:offer}],{state:'identificacion_pendiente',selected_partner:'Cooperativa JEP'})
  assert.match(accepted.reply,/Cooperativa JEP/);assert.match(accepted.reply,/nombre completo/);assert.match(accepted.reply,/cédula/)
  results.push({case:'accepted JEP',...accepted});console.log(JSON.stringify(results.at(-1)))
  const location = locationAnswer(info,'request')
  assert.ok(location.includes(info.proyecto.address));assert.ok(location.includes(info.ubicacion))
  results.push({case:'requested location',reply:location});console.log(JSON.stringify(results.at(-1)))
  fs.mkdirSync('tmp',{recursive:true});fs.writeFileSync('tmp/multi-topic-evaluation.json',JSON.stringify(results,null,2))
  console.log(JSON.stringify({passed:results.length,client_messages_sent:0,financial_writes:0}))
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
