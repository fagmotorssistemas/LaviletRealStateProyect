const test=require('node:test'),assert=require('node:assert/strict')
require('./test-typescript.cjs')
const {projectQuantityEvidence,validateProjectQuantities,withoutSupportedQuantities}=require('../src/lib/integrations/automation/project-quantities.ts')
const evidence=projectQuantityEvidence({instalaciones:[{amenity_name:'Sistemas de seguridad 24h',description:'Vigilancia permanente'},{amenity_name:'Piscina',description:'Sesiones de 30 minutos'}]})
test('quantity equivalents retain their subject, dimension, origin and exact span',()=>{
  for(const reply of ['Sistemas de seguridad 24 horas.','Seguridad 24h.','Seguridad durante 1440 minutos.','La piscina ofrece sesiones de 0,5 horas.']){
    const result=validateProjectQuantities(reply,evidence)
    assert.deepEqual(result.issues,[],reply)
    assert.equal(result.details[0].outcome,'supported')
    assert.ok(result.details[0].evidence[0].source.startsWith('instalaciones.'))
  }
  const result=validateProjectQuantities('Seguridad 24 horas; precio de USD 24.',evidence)
  assert.match(withoutSupportedQuantities('Seguridad 24 horas; precio de USD 24.',result.supportedSpans),/USD 24/)
})
test('values cannot migrate to another attribute or be approved by matching a number elsewhere',()=>{
  for(const reply of ['Piscina durante 24 horas.','Seguridad durante 30 minutos.','Seguridad durante 48 horas.','Seguridad a 24 metros.']){
    assert.notEqual(validateProjectQuantities(reply,evidence).issues.length,0,reply)
  }
  assert.equal(validateProjectQuantities('Gimnasio durante 24 horas.',evidence).details[0].outcome,'unresolved')
  assert.equal(validateProjectQuantities('Seguridad durante 48 horas.',evidence).details[0].outcome,'contradicted')
})
test('conflicting sources and untrusted conversation text do not authorize quantities',()=>{
  const conflict=projectQuantityEvidence({instalaciones:[{amenity_name:'Seguridad 24h'},{amenity_name:'Seguridad 12h'}]})
  assert.ok(validateProjectQuantities('Seguridad 24 horas.',conflict).issues.includes('quantity_evidence_conflict'))
  assert.deepEqual(projectQuantityEvidence({historial:[{content:'Seguridad 24h'}],summary:'Piscina 24h',mensaje_actual:'Seguridad 24h'}),[])
})
test('bounds, percentages and distances use dimensions without treating square meters as distance',()=>{
  const facts=projectQuantityEvidence({instalaciones:[{amenity_name:'Parque',description:'Distancia al parque: 2 km'}],politica_comercial:{title:'Entrada',description:'Entrada de 20%'}})
  assert.deepEqual(validateProjectQuantities('El parque está a 2000 metros. Entrada de 20 por ciento.',facts).issues,[])
  assert.deepEqual(validateProjectQuantities('El parque está a menos de 3 km.',facts).issues,[])
  assert.ok(validateProjectQuantities('El parque está a más de 3 km.',facts).issues.length)
  assert.equal(validateProjectQuantities('Área interior de 120 m².',facts).details.length,0)
})

test('delivery approval is bound to content and allows only known surface changes and confirmed notices',()=>{
  const {requiresContentReview}=require('../src/lib/integrations/automation/delivery-integrity.ts')
  const approved='Seguridad 24 horas. ¿Qué unidad le interesa?'
  assert.equal(requiresContentReview(approved,'Hola. '+approved),false)
  assert.equal(requiresContentReview(approved,'Aviso confirmado.\n\n'+approved,'Aviso confirmado.'),false)
  assert.equal(requiresContentReview(approved,'Aviso inventado.\n\n'+approved,'Aviso confirmado.'),true)
  assert.equal(requiresContentReview(approved,approved.replace('24','48')),true)
  assert.equal(requiresContentReview(approved,'Seguridad 24 horas.'),true)
  assert.equal(requiresContentReview('Precio 2.500 USD.','Precio 25.00 USD.'),true)
})
