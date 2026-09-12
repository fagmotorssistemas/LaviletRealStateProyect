// Explicit live evaluation: reads catalogue/prompts, calls OpenAI, never sends
// WhatsApp messages or writes business data. Run: node scripts/evaluate-sales-policy.cjs --live
if (!process.argv.includes('--live')) throw Error('Use --live to authorize billable model evaluation')
require('@next/env').loadEnvConfig(process.cwd())
require('./test-typescript.cjs')
const Module = require('node:module'), path = require('node:path'), assert = require('node:assert/strict')
const original = Module._load
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(process.cwd(), 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
const { commercialContext, commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { PROJECT_POSITIONING } = require('../src/lib/integrations/automation/commercial-experience.ts')
const { salesTopics } = require('../src/lib/integrations/automation/sales-policy.ts')
const { resolveCatalogReference } = require('../src/lib/integrations/automation/catalog-reference.ts')
const { unitModelDelivery, appendUnitModel } = require('../src/lib/integrations/automation/unit-model.ts')
async function main() {
  const cases = [
    {name:'project_intro', current:'Buenas tardes, quisiera saber más información sobre el proyecto', history:[]},
    {name:'three_concerns', current:'quiero espacios verdes, si es posible quieor conover mas sobre el sector en donde se encuentra y en caso querer venderlo en el futuro queir sabaer que tan viable eso', history:[]},
    {name:'unit_photo', current:'Envíeme una fotografía', history:[{role:'cliente',content:'Me interesa el departamento 210'}]},
    {name:'interest_after_model',current:'Se ve interesante', history:[{role:'bot',content:'Aquí puede explorar la suite 210 en 3D: https://www.lavilett.com/tour/modelo-3d/segunda-planta.html?unidad=210'}]},
  ]
  for (const sample of cases) {
    const info = await commercialContext({name:'Prueba',preferred_category:sample.name==='project_intro'?null:'suite',purchase_purpose:sample.name==='project_intro'?null:'vivir'},sample.history)
    info.posicionamiento_proyecto=PROJECT_POSITIONING
    info.referencia_unidad=resolveCatalogReference(info.catalogo,sample.current,{},sample.history)
    const model=unitModelDelivery(info.referencia_unidad,sample.current,sample.history)
    info.modelo_3d=model?{unidad:model.unit_number,se_adjunta_en_esta_respuesta:true}:null
    const generated=await commercialReply(info,sample.current,{},async()=>{})
    const reply=appendUnitModel(generated.reply,model)
    assert.ok(reply.length<1500)
    assert.ok((reply.replace(/https?:\/\/\S+/g,'').match(/\?/g)||[]).length<=1)
    if(sample.name==='three_concerns') {
      for(const topic of ['jardines','sector','reventa']) assert.ok(salesTopics(reply).includes(topic),topic)
      assert.doesNotMatch(reply,/garantizamos|ganancia asegurada|información imprecisa/)
    }
    if(model)assert.ok(reply.includes('unidad=210'))
    console.log(JSON.stringify({scenario:sample.name,reply,audit:generated.audit}))
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
