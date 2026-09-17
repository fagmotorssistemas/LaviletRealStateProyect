/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {directReply,DIRECT_REPLY_RULE}=require('../src/lib/integrations/automation/direct-reply.ts')
const {configuredToneInstructions}=require('../src/lib/integrations/automation/tone-settings.ts')
const {toneDirection}=require('../src/lib/inmobiliaria/conversationTone.ts')
test('removes customer echo and generic intent closing while retaining prices and useful question',()=>{
 const facts='Tenemos locales en planta baja, desde $145.000 hasta $535.000. Son valores aproximados. ¿Qué tipo de negocio tiene pensado abrir?'
 for(const opener of ['Comprendo que le interesa','Veo que desea','Entiendo que busca']) {
   assert.equal(directReply(`${opener} abrir un local comercial. ${facts} Así puedo orientarle mejor según sus planes.`,'interesante, quiero abrir un local'),facts)
 }
 assert.equal(directReply('Hola, Carlos. Comprendo que le interesa abrir un local comercial. '+facts,'quiero abrir un local'),'Hola, Carlos. '+facts)
 assert.equal(directReply('¿Busca vivienda o un local? Así le oriento con lo que más se ajuste a lo que busca.','quiero información'),'¿Busca vivienda o un local?')
})
test('retains concerns, qualifications, confirmed details, links and explanations with information',()=>{
 for(const reply of ['Entiendo que le preocupa el presupuesto. Podemos revisar las opciones.','Entiendo que busca un local sin escaleras. Revisaremos el acceso.','Comprendo que le interesa el local 202. Su precio es $145.000.','Su visita está confirmada para el sábado a las 11:00.','Comprendo que le interesa abrir un local comercial, pero falta verificar los permisos. ¿Qué negocio desea abrir?','Puede revisar https://example.com/plano.pdf. ¿Desea conocer la distribución?','Así podemos verificar si la actividad está permitida en ese local.'])assert.equal(directReply(reply,'quiero abrir un local'),reply)
 assert.equal(directReply('Comprendo que le interesa abrir un local comercial.','quiero abrir un local'),'Comprendo que le interesa abrir un local comercial.')
 assert.equal(directReply('Veo que desea vivir cerca del centro. Hay opciones.','quiero abrir un local'),'Veo que desea vivir cerca del centro. Hay opciones.')
})
test('rule applies to original and every slider combination in writing and review, without changing data extraction',async()=>{
 for(const style of ['actual','cercano','equilibrado','elegante'])for(const warmth of [0,1,2])for(const detail of [0,1,2]) {
   for(const task of ['writing','review'])assert.ok((await configuredToneInstructions('Base',{style,warmth,detail},task)).includes(DIRECT_REPLY_RULE))
   assert.equal(await configuredToneInstructions('Base',{style,warmth,detail},'data'),'Base')
 }
 assert.match(toneDirection({style:'cercano',warmth:2,detail:2}),/sin repetir lo que acaba de decir/)
})
