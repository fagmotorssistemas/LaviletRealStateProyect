/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module')
const original=Module._load
Module._load=function(id,parent,main){if(id==='server-only')return {};if(id.startsWith('@/'))id=path.resolve('src',id.slice(2));return original.call(this,id,parent,main)}
require('./test-typescript.cjs')
const {resolveCatalogReference,catalogReferenceReply}=require('../src/lib/integrations/automation/catalog-reference.ts')
const {unitPriceQuote}=require('../src/lib/integrations/automation/price-reply.ts')
const {currentTopicReply}=require('../src/lib/integrations/automation/current-topic.ts')
const catalog=[{id:'202',unit_number:'202',category:'departamento',area_internal_m2:120.83,published_commercial_price:250000},{id:'602',unit_number:'602',category:'departamento',area_internal_m2:142.09,published_commercial_price:550000},{id:'605',unit_number:'605',category:'departamento',area_internal_m2:140.53,published_commercial_price:550000}]
const saved={ids:['202'],numbers:['202']}
test('largest apartment replaces earlier unit and coticemos produces the matching quote',()=>{
  const current='Entiendo, bueno coticemos el departamento más grande que tiene'
  const result=resolveCatalogReference(catalog,current,saved)
  assert.deepEqual(result.memory.ids,['602'])
  const quote=unitPriceQuote({catalogo:catalog,politica_comercial:{precios_autorizados:true}},current,{_unit_reference:saved})
  assert.equal(quote.quoted,true)
  assert.deepEqual(quote.units.map(u=>u.id),['602'])
  assert.doesNotMatch(quote.reply,/202/)
})
test('building questions do not borrow the previous unit; genuine unit references survive',()=>{
  const current='que tiene el edificio, o sea por que deberia comprar ahi?'
  assert.deepEqual(resolveCatalogReference(catalog,current,saved).matches,[])
  assert.equal(catalogReferenceReply([catalog[0]],current),'')
  assert.equal(resolveCatalogReference(catalog,'¿Y ese qué tiene?',saved).matches[0].id,'202')
  assert.equal(resolveCatalogReference(catalog,'¿Qué tiene el departamento 202 y el edificio?',saved).matches[0].id,'202')
  const history=[{role:'cliente',content:'Quiero el departamento 202'},{role:'cliente',content:'Coticemos el departamento más grande'}]
  assert.equal(resolveCatalogReference(catalog,'Muéstreme el plano',saved,history).matches[0].id,'602')
})
test('ranking does not ignore unknown area or an additional budget constraint',()=>{
  assert.deepEqual(resolveCatalogReference([...catalog,{category:'departamento',id:'unknown'}],'El departamento más grande',saved).matches,[])
  assert.deepEqual(resolveCatalogReference(catalog,'El departamento más grande con presupuesto de 300 mil',saved).matches,[])
})
test('direct credit denial is removed only when unrelated to the current request',()=>{
  const reply='El precio es de $550,000. No se ofrece crédito directo; los bancos aliados son Banco Pichincha y Cooperativa JEP.'
  assert.doesNotMatch(currentTopicReply(reply,'Coticemos el departamento más grande'),/crédito directo/)
  assert.match(currentTopicReply(reply,'Coticemos el departamento más grande'),/550,000/)
  assert.equal(currentTopicReply(reply,'¿Tienen crédito directo?'),reply)
  assert.equal(currentTopicReply('Podemos revisar un crédito con JEP.','¿Tienen financiamiento?'),'Podemos revisar un crédito con JEP.')
})
