// Real project data and model; synthetic conversations. No writes and no Kommo sends.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..');require('@next/env').loadEnvConfig(root)
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.join(root,'src',id.slice(2));return original.call(this,id,parent,main)}
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
require.extensions['.ts']=(m,f)=>m._compile(compile(f),f)
const filename=path.join(root,'src/lib/integrations/automation/sdr.ts'),copy={exports:{}},ai=require('../src/lib/integrations/automation/ai.ts')
new Function('require','module','exports',compile(filename))(id=>id==='./ai'?{...ai,activePrompt:async name=>fs.readFileSync(path.join(root,'docs/prompts/'+name+'.md'),'utf8'),draftReply:async(...args)=>{const r=await ai.draftReply(...args);if(process.argv.includes('--debug'))console.log('DRAFT',r);return r}}:Module.createRequire(filename)(id),copy,copy.exports)
const {commercialContext,commercialReply}=copy.exports
const {commercialMemory,rememberCommercialReply}=require('../src/lib/integrations/automation/commercial-experience.ts')
async function main(){
 let memory={mentioned_benefits:[],deferred_fields:[]}
 const cases=[
  {name:'intro',message:'Quiero saber más sobre el proyecto',category:null,purpose:null,history:[],check:r=>{assert.ok(r.split(/\s+/).length<=90);assert.doesNotMatch(r,/unidades residenciales|circulación/)}},
  {name:'suite after pool and gym',message:'Quiero saber más sobre suites',category:'suite',purpose:'invertir',history:[{role:'bot',content:'El proyecto tiene piscina y gimnasio.'}],check:r=>{assert.doesNotMatch(r,/piscina|gimnasio|m²|asesor/i);assert.match(r,/suite|inversi|invertir/i)}},
  {name:'plain clarification and known areas',message:'No entiendo a qué se refiere con circulación comercial independiente, ni los parqueaderos. No sé qué tamaño necesitaría, ¿de qué tamaño son?',category:'local',purpose:'invertir',history:[{role:'bot',content:'La circulación comercial es independiente y hay parqueaderos en subsuelos. ¿Qué tamaño busca?'}],check:r=>{assert.match(r,/entrada|acceso/);assert.match(r,/bajo tierra|subterr|debajo/);assert.match(r,/\d.*m²|\d.*metros/);assert.doesNotMatch(r,/qué tamaño.*(?:mente|busca)|no (?:hay|tenemos|se tiene).*área/i)}},
  {name:'unsure of size',message:'No tenía idea la verdad, no he pensado en eso',category:'local',purpose:'invertir',history:[{role:'bot',content:'¿Qué tamaño aproximado tiene en mente para el local?'}],check:r=>assert.doesNotMatch(r,/qué tamaño|cuántos metros.*necesita/i)},
  {name:'daily life nearby',message:'Me interesa vivir allí, ¿qué hay cerca para el día a día?',category:'suite',purpose:'vivir',history:[],check:r=>{assert.match(r,/supermercad|cafeter|banco|Supermaxi|parque/i);assert.doesNotMatch(r,/no necesita salir|hay de todo|a \d+ minutos|a pocos minutos/i)}},
  {name:'investment without guarantees',message:'¿Por qué sería interesante invertir en ese sector? ¿Me aseguran que subirá de precio?',category:'suite',purpose:'invertir',history:[],check:r=>{assert.match(r,/no (?:podemos |es posible )?(?:garantiz|asegur)|sin garant|no (?:existe una garantia|se puede|se garantiza)/i);assert.match(r,/ubicaci|sector|plusval|valoriz/i)}},
  {name:'explicit pool question may repeat',message:'¿La piscina es para residentes?',category:'suite',purpose:'vivir',history:[{role:'bot',content:'Cuenta con piscina para residentes y gimnasio.'}],check:r=>assert.match(r,/piscina.*resident|resident.*piscina/i)},
 ]
 for(const c of cases){
  if(process.env.EXPERIENCE_CASE && c.name!==process.env.EXPERIENCE_CASE)continue
  memory=commercialMemory(memory,c.history,c.message)
  const info={...await commercialContext({preferred_category:c.category,purchase_purpose:c.purpose,name:''},c.history),memoria_comercial:memory}
  const r=await commercialReply(info,c.message,{},async()=>{})
  console.log(JSON.stringify({case:c.name,reply:r.reply,audit:r.audit}))
  if(c.name==='intro')assert.equal(r.audit.fallback,false,c.name+' must resolve without fallback')
  c.check(r.reply);memory=rememberCommercialReply(memory,r.reply)
 }
 console.log('PASS selected cases; no database writes, no messages sent.')
}
main().catch(e=>{console.error(e.message,e.cause?.code||'');process.exitCode=1})
