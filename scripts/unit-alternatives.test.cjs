/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {unitAlternative,UNIT_ALTERNATIVE_RULES}=require('../src/lib/integrations/automation/unit-alternatives.ts')
const {DIRECT_CONVERSATION_RULE}=require('../src/lib/integrations/automation/direct-conversation-rule.ts')
const unit=(id,rooms,area,price=300000)=>({id,unit_number:id,category:'departamento',bedrooms:rooms,area_internal_m2:area,published_commercial_price:price,floor_number:6,spaces:['Balcones'],status:'disponible',is_published:true})
const info={catalogo:[unit('202',3,120.83),unit('602',3,142.09,550000),unit('605',3,140.53,500000),unit('201',2,100)]}
test('unavailable bedrooms recommend from live facts without changing declared preference',()=>{
  const original=JSON.stringify(info)
  for(const word of ['5 cuartos','cinco dormitorios','5 habitaciones']){
    const value=unitAlternative(info,`Quiero un departamento de ${word}`)
    assert.equal(value.unit.id,'602');assert.match(value.reply,/142[.,]09/)
    assert.doesNotMatch(value.reply,/igual de comodo|convertir|oficina|sala de TV|https:/)
  }
  assert.equal(JSON.stringify(info),original)
  assert.equal(unitAlternative(info,'Quiero un departamento de 3 dormitorios'),null)
  assert.equal(unitAlternative({...info,catalogo:info.catalogo.filter(u=>u.id!=='602')},'Quiero 5 dormitorios').unit.id,'605')
})
test('budget, availability, unknown facts and firm requirements restrict alternatives',()=>{
  assert.equal(unitAlternative(info,'Quiero 5 dormitorios',310000).unit.id,'202')
  assert.equal(unitAlternative(info,'Quiero 5 dormitorios',200000),null)
  assert.equal(unitAlternative({...info,catalogo:[{...unit('602',3,142),status:'vendido'},unit('202',3,120)]},'Quiero 5 dormitorios').unit.id,'202')
  assert.equal(unitAlternative(info,'Necesito exactamente 5 dormitorios').unit,null)
  assert.equal(unitAlternative({...info,catalogo:[{...unit('202',3,120),bedrooms:null}]},'Quiero 5 dormitorios'),null)
})
test('numeric floor and interior area alternatives do not treat a terrace as interior',()=>{
  assert.equal(unitAlternative(info,'Quiero un departamento en piso 8').unit.id,'602')
  assert.equal(unitAlternative(info,'Busco un departamento de 180 m²').unit.id,'602')
  assert.equal(unitAlternative(info,'Busco un departamento de 120 m²'),null)
})
test('operational requests, refusals and additional physical constraints stay contextual',()=>{
  for(const message of ['Quiero agendar una cita para un departamento de 5 dormitorios','No quiero 5 dormitorios','Quiero un departamento de 5 dormitorios con jardín','Busco entre 2 y 3 dormitorios','Quiero financiar un departamento 202'])assert.equal(unitAlternative(info,message),null,message)
  assert.ok(DIRECT_CONVERSATION_RULE.includes(UNIT_ALTERNATIVE_RULES))
  assert.equal(unitAlternative({...info,historial:[{role:'cliente',content:'Mi presupuesto es de 300 mil dólares'}]},'Quiero 5 dormitorios'),null)
})

test('commercial and price paths use the same alternative without requiring a fixed unit',async()=>{
  const {commercialReply}=require('../src/lib/integrations/automation/sdr.ts')
  const {unitPriceQuote}=require('../src/lib/integrations/automation/price-reply.ts')
  const context={...info,alcance_negocio:'property',historial:[],politica_comercial:{precios_autorizados:true}}
  const commercial=await commercialReply(context,'Quiero un departamento de 5 dormitorios',{},async()=>{})
  assert.equal(commercial.audit.source,'unit_alternative')
  assert.match(commercial.reply,/departamento 602/)
  const price=unitPriceQuote(context,'Cuánto cuesta un departamento de 5 dormitorios?',{})
  assert.match(price.reply,/departamento 602/)
  assert.equal(price.quoted,false)
  assert.doesNotMatch(price.reply,/\$/)
})
