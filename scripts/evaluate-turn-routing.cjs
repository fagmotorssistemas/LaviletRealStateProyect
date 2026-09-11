// Synthetic classification checks: calls AI only, never writes DB or sends messages.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..');require('@next/env').loadEnvConfig(root)
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.join(root,'src',id.slice(2));return original.call(this,id,parent,main)}
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,f)
const {aiJson}=require('../src/lib/integrations/automation/ai.ts')
const {visitIntentPrompt}=require('../src/lib/integrations/automation/conversation.ts')
const {TURN_RULES}=require('../src/lib/integrations/automation/turn-routing.ts')
const extractor=fs.readFileSync(path.join(root,'docs/prompts/extractor_eventos.md'),'utf8')+'\n'+TURN_RULES
async function main(){
 const cases=[
  {message:'Muchas gracias, estaré puntual',last:'Su cita está confirmada para el sábado a las 11.',status:'confirmed',intent:'question'},
  {message:'Ya quedamos en una cita o no?',last:'Su cita está confirmada para el sábado a las 11.',status:'confirmed',intent:'question'},
  {message:'Mejor quiero cancelar mi cita',last:'Su cita está confirmada para el sábado a las 11.',status:'confirmed',intent:'cancel'},
  {message:'No',last:'Hemos cancelado la cita. ¿Le gustaría visitarnos más tarde o prefiere otro día?',status:null},
  {message:'Con la jep',last:'Podemos revisar Banco Pichincha o Cooperativa JEP. ¿Le gustaría revisar esa opción?',status:null},
  {message:'no entiendo, puede comunicarme con un asesor?',last:'¿Le gustaría iniciar una revisión de financiamiento?',status:null},
 ]
 for(const c of cases){
  const history=[{role:'bot',content:c.last}], proposal=c.status?{status:c.status,appointment_start_time:'2026-09-12T16:00:00Z'}:null
  const r=await aiJson(extractor,{mensaje_actual:c.message,historial:history,ultima_pregunta:c.last,propuestas:proposal?[proposal]:[],coordinacion_visita:null,financiamiento:{partners:['Banco Pichincha','Cooperativa JEP'],current:{explicit_consent:false}}})
  assert.ok(!r.events?.includes('requested_visit'),c.message+': invented visit')
  if(c.message==='No')assert.ok(r.financing_consent==null && !r.events?.includes('asked_financing'))
  if(c.message==='Con la jep')assert.match(r.financing_partner,/JEP/i)
  if(c.message.includes('comunicarme'))assert.equal(r.requested_advisor,true)
  if(c.intent){const v=await aiJson(visitIntentPrompt+'\n'+TURN_RULES,{mensaje_cliente:c.message,propuesta:proposal,historial:history});assert.equal(v.intent,c.intent,c.message)}
  console.log('PASS',c.message)
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
