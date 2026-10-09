import test from 'node:test'
import assert from 'node:assert/strict'
import { commercialMemory, experienceIssues, needsDimensions, residentialContinuity, unresolvedCommercialReply } from './commercial-experience'
import { commercialJourneyPlan } from './commercial-journey'
import { isPropertyScopeRedirect, salesSubject } from './sales-subject'

const budgetHistory = [{ role: 'bot', content: '¿Qué presupuesto total aproximado tiene previsto para la compra?' }]
const memory = { mentioned_benefits: [], deferred_fields: [] }

test('positive Bueno budget statements never defer budget discovery because of the suffix no', () => {
  for (const current of ['Bueno estoy seguro del presupuesto', 'Bueno sé mi presupuesto', 'Bueno tengo claro el presupuesto',
    'Bueno he pensado en mi presupuesto', 'Bueno, estoy segura del presupuesto', 'Busco un presupuesto para vivienda, no seguridad extra']) {
    const remembered = commercialMemory({}, budgetHistory, current)
    assert.deepEqual(remembered.deferred_fields, [], current)
    const plan = commercialJourneyPlan({ lead: { purchase_purpose: 'vivir' }, recorrido_comercial: {},
      perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' }, memoria_comercial: remembered,
      property_context: { query: { group: 'residential', filters: {} } },
      catalogo: [{ id: 'd202', category: 'departamento', bedrooms: 3, floor_number: 2 }] })
    assert.equal(plan.action, 'ask_budget', current)
    assert.equal(plan.question_id, 'budget_amount', current)
  }
})

test('genuine budget uncertainty still records deferral, including a Bueno prefix', () => {
  for (const current of ['No sé mi presupuesto', 'No estoy seguro del presupuesto', 'No estoy segura del presupuesto',
    'No tengo idea del presupuesto', 'Bueno, no tengo claro el presupuesto', 'No lo he pensado']) {
    assert.deepEqual(commercialMemory({}, budgetHistory, current).deferred_fields, ['presupuesto'], current)
  }
})

test('a Bueno acknowledgement is not a request to rediscover dimensions while a real unknown size is', () => {
  const saved = { mentioned_benefits: [], deferred_fields: ['area_buscada'] }
  assert.equal(needsDimensions('Bueno sé lo que necesito', saved), false)
  assert.equal(needsDimensions('No sé lo que necesito', saved), true)
})

test('positive housing and vehicle declarations retain their scope after Bueno; real negatives still exclude the rejected subject', () => {
  for (const current of ['Bueno quiero vivienda', 'Bueno quiero departamentos', 'Bueno necesito un departamento',
    'Bueno me interesa una vivienda', 'Bueno, quiero una vivienda']) {
    assert.equal(salesSubject(current).subject, 'property', current)
  }
  for (const current of ['Bueno quiero motos', 'Bueno busco vehículos']) {
    assert.equal(salesSubject(current).subject, 'vehicle', current)
  }
  assert.equal(salesSubject('No quiero vivienda').subject, 'unknown')
  assert.equal(salesSubject('Bueno no quiero departamentos, quiero una moto').subject, 'vehicle')
  assert.equal(salesSubject('Quiero una moto, no departamentos').subject, 'vehicle')
  assert.equal(salesSubject('Ya no quiero motos, quiero departamentos').subject, 'property')
})

test('offering property after Bueno is not a scope rejection; genuine unrelated-service boundaries retain their meaning', () => {
  for (const reply of ['Bueno ofrecemos departamentos en La Vilet', 'Bueno gestionamos viviendas en La Vilet',
    'Bueno podemos ayudar con los departamentos']) {
    assert.equal(isPropertyScopeRedirect(reply), false, reply)
  }
  assert.equal(isPropertyScopeRedirect('No vendemos vehículos. Podemos ayudarle con las viviendas de La Vilet.'), true)
  assert.equal(isPropertyScopeRedirect('Bueno, no organizamos viajes. Ofrecemos información de las viviendas de La Vilet.'), true)
  assert.equal(isPropertyScopeRedirect('No ofrecemos departamentos de cinco dormitorios en La Vilet.'), false)
})

test('Bueno entiendo can acknowledge a real scope redirect; No entiendo cannot', () => {
  const history = [{ role: 'cliente', content: 'Busco una moto' },
    { role: 'bot', content: 'No vendemos vehículos. Podemos ayudarle con viviendas en La Vilet.' }]
  assert.equal(salesSubject('Bueno entiendo', history).subject, 'property')
  assert.equal(salesSubject('Bueno entiendo', history).acceptedRedirect, true)
  assert.equal(salesSubject('No entiendo', history).subject, 'vehicle')
  assert.equal(salesSubject('No entiendo', history).acceptedRedirect, false)
})

test('a positive Bueno comparison never declares that suites were rejected', () => {
  const current = 'Para vivir', positive = { historial: [{ role: 'cliente', content: 'Bueno departamentos y suites' }], catalogo: [] }
  assert.equal(residentialContinuity(positive, current).category_already_chosen, false)
  const negative = { historial: [{ role: 'cliente', content: 'Departamentos, no suites' }], catalogo: [] }
  assert.equal(residentialContinuity(negative, current).category_already_chosen, true)
})

test('Bueno confirmed information remains deliverable; actual missing information still requests operational resolution', () => {
  assert.equal(unresolvedCommercialReply('Bueno tengo el precio publicado de esa unidad.'), false)
  assert.equal(unresolvedCommercialReply('No tengo el precio publicado de esa unidad.'), true)
  const info = { catalogo: [{ area_internal_m2: 120.83 }] }
  assert.equal(experienceIssues('Bueno tengo las medidas exactas del área.', '¿Qué tamaño tiene?', info, memory).includes('unsupported_fact'), false)
  assert.equal(experienceIssues('No tengo las medidas exactas del área disponible.', '¿Qué tamaño tiene?', info, memory).includes('unsupported_fact'), true)
})
