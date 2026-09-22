/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {unitAlternative,UNIT_ALTERNATIVE_RULES}=require('../src/lib/integrations/automation/unit-alternatives.ts')
const {DIRECT_CONVERSATION_RULE}=require('../src/lib/integrations/automation/direct-conversation-rule.ts')
const unit=(id,rooms,area,price=300000,category='departamento')=>({id,unit_number:id,category,bedrooms:rooms,area_internal_m2:area,published_commercial_price:price,floor_number:Number(id[0]),spaces:['Balcones'],status:'disponible',is_published:true})
const info={catalogo:[unit('202',3,120.83,250000),unit('602',3,142.09,550000,'penthouse'),unit('605',3,140.53,550000,'penthouse'),unit('201',2,100)]}
test('unavailable bedrooms offer verified categories without choosing an expensive unit',()=>{
  const original=JSON.stringify(info)
  for(const word of ['5 cuartos','cinco dormitorios','5 habitaciones']){
    const value=unitAlternative(info,`Quiero un departamento de ${word}`)
    assert.equal(value.unit,null);assert.equal(value.phase,'compare_categories')
    assert.match(value.reply,/departamentos de 3 dormitorios/);assert.match(value.reply,/penthouses/)
    assert.match(value.reply,/comparemos ambas alternativas/)
    assert.doesNotMatch(value.reply,/602|605|142[.,]09|igual de comodo|convertir|oficina|sala de TV|https:/)
  }
  assert.equal(JSON.stringify(info),original)
  assert.equal(unitAlternative(info,'Quiero un departamento de 3 dormitorios'),null)
  assert.equal(unitAlternative({...info,catalogo:info.catalogo.filter(u=>u.id!=='602')},'Quiero 5 dormitorios').unit,null)
})
test('a confirmed unavailable bedroom requirement continues the conversation without repeating the unit card',()=>{
  const first=unitAlternative(info,'Quiero un departamento de 5 cuartos para mi familia')
  const threaded={...info,historial:[{role:'cliente',content:'Quiero un departamento de 5 cuartos para mi familia'},{role:'bot',content:first.reply}]}
  const followUp=unitAlternative(threaded,'A ver revisemos, si necesitas los 5 cuartos')
  assert.equal(followUp.unit,null)
  assert.match(followUp.reply,/necesita 5 dormitorios/)
  assert.match(followUp.reply,/llegan hasta 3 dormitorios/)
  assert.doesNotMatch(followUp.reply,/penthouse 602|142[.,]09|Le recomendaría revisar/)
})
test('budget, availability, unknown facts and firm requirements restrict alternatives',()=>{
  assert.equal(unitAlternative(info,'Busco un departamento de 180 m²',310000).unit.id,'202')
  assert.equal(unitAlternative(info,'Busco un departamento de 180 m²',200000),null)
  for(const budget of [310000,200000]) {
    const proposal=unitAlternative(info,'Quiero 5 dormitorios',budget)
    assert.equal(proposal.unit,null)
    assert.doesNotMatch(proposal.reply,/dentro de su presupuesto|se ajusta a su presupuesto|602|550/)
  }
  const available=unitAlternative({...info,catalogo:[{...unit('602',3,142,550000,'penthouse'),status:'vendido'},unit('202',3,120)]},'Quiero 5 dormitorios')
  assert.equal(available.unit,null)
  assert.match(available.reply,/departamentos de 3 dormitorios/)
  assert.doesNotMatch(available.reply,/penthouse|602|ambas alternativas/)
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
  const knownBudget=unitAlternative({...info,historial:[{role:'cliente',content:'Mi presupuesto es de 300 mil dólares'}]},'Quiero 5 dormitorios')
  assert.equal(knownBudget.unit,null)
  assert.doesNotMatch(knownBudget.reply,/se ajusta a su presupuesto|dentro de su presupuesto|602|550/)
})

test('commercial and price paths use the same alternative without requiring a fixed unit',async()=>{
  const {commercialReply}=require('../src/lib/integrations/automation/sdr.ts')
  const {unitPriceQuote}=require('../src/lib/integrations/automation/price-reply.ts')
  const context={...info,alcance_negocio:'property',historial:[],politica_comercial:{precios_autorizados:true}}
  const commercial=await commercialReply(context,'Quiero un departamento de 5 dormitorios',{},async()=>{})
  assert.equal(commercial.audit.source,'catalog_search')
  assert.match(commercial.reply,/no contamos con (?:departamentos|viviendas) disponibles de 5 dormitorios/)
  assert.match(commercial.reply,/alternativas.*departamentos de 3 dormitorios.*penthouses/s)
  assert.equal(commercial.audit.catalog_query.filters.bedrooms,5)
  assert.deepEqual(commercial.audit.selected_unit_ids,[])
  assert.doesNotMatch(commercial.reply,/penthouse 602|presupuesto aproximado/)
  const price=unitPriceQuote(context,'Cuánto cuesta un departamento de 5 dormitorios?',{})
  assert.match(price.reply,/no contamos con departamentos disponibles de 5 dormitorios/)
  assert.match(price.reply,/comparemos ambas alternativas/)
  assert.equal(price.quoted,false)
  assert.doesNotMatch(price.reply,/\$/)
})

test('a category declaration cannot suppress bedroom requirements or physical constraints',async()=>{
  const {propertySelectionReply}=require('../src/lib/integrations/automation/property-selection.ts')
  const {continueUnitAlternative}=require('../src/lib/integrations/automation/unit-alternatives.ts')
  const {commercialReply}=require('../src/lib/integrations/automation/sdr.ts')
  for(const current of ['Quiero un departamento de cuatro dormitorios','Prefiero departamentos de 5 cuartos','Quiero un departamento con jardín']) {
    for(const semantica_turno of [{},{primary_intent:'select_property',property:{category:'departamento',excluded_categories:[],confidence:'high'}}]) {
      const context={...info,semantica_turno,alcance_negocio:'property',politica_comercial:{precios_autorizados:true},
        property_context:{journey:'residential_alternatives',phase:'choose_category'},
        historial:[{role:'bot',content:'¿Desea revisar primero los departamentos o los penthouses?'}]}
      assert.equal(propertySelectionReply(context,current),null,current)
      assert.equal(continueUnitAlternative(context,current),null,current)
      if(current.includes('cuatro')) {
        const commercial=await commercialReply(context,current,{},async()=>({}))
        assert.equal(commercial.audit.source,'catalog_search')
        assert.match(commercial.reply,/no contamos con (?:departamentos|viviendas) disponibles de 4 dormitorios/)
      }
    }
  }
  const firm=unitAlternative(info,'Necesito exactamente 5 dormitorios')
  assert.equal(firm.unit,null)
  assert.doesNotMatch(firm.reply,/Sin embargo|comparar|penthouse/)
  const priorOffer=unitAlternative(info,'Quiero 5 dormitorios')
  const repeatedFirm=unitAlternative({...info,historial:[{role:'bot',content:priorOffer.reply}]},'Necesito exactamente 5 dormitorios')
  assert.equal(repeatedFirm.unit,null)
  assert.doesNotMatch(repeatedFirm.reply,/Sin embargo|comparar|penthouse/)
})
