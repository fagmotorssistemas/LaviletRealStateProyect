/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {inventedRentalPolicy,recommendationClarification,sectorClaimsReply,COMMERCIAL_ACCURACY_RULES}=require('../src/lib/integrations/automation/commercial-accuracy.ts')
const {safeRentalCreditBase,completeTurnReply}=require('../src/lib/integrations/automation/turn-completeness.ts')
const {statedBudget,budgetOptionsReply}=require('../src/lib/integrations/automation/price-reply.ts')
const {directReply}=require('../src/lib/integrations/automation/direct-reply.ts')
const {configuredToneInstructions}=require('../src/lib/integrations/automation/tone-settings.ts')
const forbidden='La política del proyecto no permite que el ingreso esperado por arriendo futuro sea tomado automáticamente como respaldo financiero.'
test('unknown bank criteria cannot become a project prohibition or an invented bank refusal',()=>{
 assert.equal(inventedRentalPolicy(forbidden,{}),true)
 assert.equal(inventedRentalPolicy('El banco no acepta ingresos de arriendos futuros.',{}),true)
 assert.equal(inventedRentalPolicy('El banco no acepta ingresos de arriendos futuros.',{financing_policy:{future_rental_income_accepted:false}}),false)
 const cleaned=safeRentalCreditBase('No ofrecemos crédito directo. '+forbidden,'Quiero rentarlo a futuro. ¿Tienen crédito directo?',{})
 assert.equal(cleaned.reply,'No ofrecemos crédito directo.')
 assert.deepEqual(cleaned.unresolved,[])
 assert.equal(inventedRentalPolicy('No tenemos información verificada sobre ese respaldo.',{}),false)
})
test('final coverage repair rejects an invented prohibition even when it claims to answer the question',async()=>{
 const current='¿Tienen crédito directo?',base='No ofrecemos crédito directo.'
 const result=await completeTurnReply({current,baseReply:base,verified:{}},async()=>({reply:base+' '+forbidden,requests:[{fragment:current,intent:'Consultar crédito directo',request_type:'specific_fact',base_status:'answered',status:'answered',evidence:base}],question:{text:'',purpose:'none',missing_datum:'',next_decision:''}}))
 assert.equal(result.reply,base);assert.equal(result.needsAdvisor,false)
 assert.ok(result.audit.issues.includes('unsupported_rental_credit_claim'))
})
const unit=(id,price)=>({unit_number:id,category:'local',is_published:true,status:'disponible',published_commercial_price:price})
const info={lead:{preferred_category:'local'},politica_comercial:{precios_autorizados:true,precios_aproximados:true},catalogo:[unit('LC-05',310000),unit('LC-02',325000),unit('LC-08',330000),unit('LC-12',355000)]}
test('budget is literal; prioritize affordable units or explicitly describe the nearest overage',()=>{
 assert.equal(statedBudget('quiero uno entre unos 300 mil dólares'),300000)
 assert.equal(statedBudget('quiero uno de 100 dólares'),100)
 assert.equal(statedBudget('quiero uno de 60 metros'),null)
 const over=budgetOptionsReply(info,'quiero uno entre unos 300 mil dólares')
 assert.match(over,/LC-05/);assert.match(over,/supera ese monto en/);assert.match(over,/flexibilidad/)
 assert.doesNotMatch(over,/LC-02|LC-12/)
 const within=budgetOptionsReply({...info,catalogo:[...info.catalogo,unit('LC-01',290000)]},'Tengo 300 mil dólares')
 assert.match(within,/dentro de ese monto: LC-01/);assert.doesNotMatch(within,/LC-05/)
 assert.equal(budgetOptionsReply({...info,politica_comercial:{precios_autorizados:false}},'Tengo 300 mil dólares'),'')
 assert.equal(budgetOptionsReply(info,'Quiero uno entre 250 mil y 300 mil dólares'),'')
 assert.equal(budgetOptionsReply(info,'Tengo 300 mil dólares y necesito terraza'),'')
 assert.equal(budgetOptionsReply(info,'Tengo 300 mil dólares, sin escaleras'),'')
})
test('recommendation clarifies a missing purpose without re-asking one already given',()=>{
 assert.match(recommendationClarification(info,'entonces si me recomienda?'),/propio negocio.*arrendarlo/)
 assert.equal(recommendationClarification({...info,lead:{preferred_category:'local',purchase_purpose:'invertir'}},'me recomienda?'),'')
 assert.equal(recommendationClarification(info,'me recomienda un banco?'),'')
})
test('reported sector claims and long generic closing are removed without altering real security amenities',()=>{
 assert.equal(sectorClaimsReply('El sector es residencial, seguro y bastante tranquilo, con bancos cerca.'),'El sector es residencial, con bancos cerca.')
 assert.equal(sectorClaimsReply('El edificio dispone de control de acceso.'),'El edificio dispone de control de acceso.')
 assert.equal(directReply('¿Lo usaría para su negocio? Así podré orientarle mejor sobre la unidad que más le conviene.','me recomienda?'),'¿Lo usaría para su negocio?')
})
test('commercial accuracy applies to every tone and both writing and review',async()=>{
 for(const style of ['actual','cercano','equilibrado','elegante'])for(const warmth of [0,1,2])for(const detail of [0,1,2])for(const task of ['writing','review'])assert.ok((await configuredToneInstructions('Base',{style,warmth,detail},task)).includes(COMMERCIAL_ACCURACY_RULES))
})
