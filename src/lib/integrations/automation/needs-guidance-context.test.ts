import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { needsSupplementaryFeatures, supplementaryFeatureFacts } from './needs-guidance'
import { semanticCatalogContext } from './semantic-catalog-context'
import { taskVerifiedContext } from './task-context'

const current = '¿Cómo podemos organizarnos en esa opción con nuestra familia?'
const facilities: Row[] = [
  { amenity_name: 'Ascensores', description: 'Conectan las plantas residenciales.', access_condition: 'Uso de residentes; mantenimiento programado.' },
  { amenity_name: 'Piscina', description: 'Espacio común.', access_condition: 'Exclusiva para residentes; no habilitada para los locales.' },
  { amenity_name: 'Zona social', description: 'Área común.', access_condition: 'Sujeta al reglamento de uso.' },
]
const units: Row[] = [
  { id: 'p602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 142.09,
    spaces: ['Terraza', 'Lavandería'], description: 'Tres dormitorios con terraza.', status: 'disponible', is_published: true },
  { id: 'p601', unit_number: '601', category: 'penthouse', floor_number: 6, bedrooms: 2, area_internal_m2: 110,
    spaces: ['Lavandería'], status: 'disponible', is_published: true },
  { id: 'lc1', unit_number: 'LC-1', category: 'local', floor_number: 0, bedrooms: null, spaces: [], status: 'disponible', is_published: true },
]
const pending: Row = { id: 'financing_data', act: 'financing', question: '¿Con qué entidad desea continuar?', target_ids: ['p602'], candidate_ids: [] }
const audit: Row = { source: 'catalog_details', catalog_retrieval: { applied: true } }
function context(semanticChanges: Row = {}): Row {
  return {
    catalogo: structuredClone(units), catalogo_verificacion: structuredClone(units), catalog_context_scope: { kind: 'semantic_candidates' },
    semantica_turno: { primary_intent: 'project_information', confidence: 'high', housing_quantities: [],
      property: { operation: 'none', reference_kind: 'followup', query_scope: 'selected', filters: {}, unit_numbers: ['602'] },
      catalog_request: { purpose: 'none', requirements: [], semantic_preferences: [] },
      budget: { status: 'not_discussed', amount: null, confidence: 'low' }, ...semanticChanges },
    contrato_turno: { objective: 'project_information', requests: [{ domain: 'property', request: current, evidence: current, confidence: 'high' }] },
    solicitudes_interpretadas: [], consultas_pendientes: [],
    property_context: { version: 2, query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected',
      filters: { bedrooms: 3 }, requirements: [{ field: 'spaces', operator: 'contains', value: 'Terraza', strength: 'required', evidence: 'quiero terraza' }] },
      selected_ids: ['p602'], offered_ids: ['p602'], comparison_ids: [], focused_ids: ['p602'], pending_question: pending },
    siguiente_paso_comercial: { action: 'collect_financing_required', question_id: pending.id, question: pending.question },
    financing_amounts: [{ role: 'down_payment', amount: 80000, evidence: 'Tengo 80 mil para la entrada', confidence: 'high' }],
    etapa_financiamiento: { selected_unit_id: 'p602', consent_required: true, requested_fields: ['partner'] },
    financiamiento: { current: { explicit_consent: false, unit_id: 'p602' } },
    instalaciones: structuredClone(facilities), lugares_cercanos: [], contexto_sector: [], politicas_negocio: [],
    proyecto: { name: 'La Vilet', address: 'Cuenca', description: 'Viviendas y locales.' },
    politica_comercial: { precios_autorizados: true },
  }
}
function assertProtectedState(projected: Row, original: Row): void {
  for (const key of ['semantica_turno', 'property_context', 'siguiente_paso_comercial', 'financing_amounts', 'etapa_financiamiento', 'financiamiento']) {
    assert.deepEqual(projected[key], original[key], key + ' must remain unchanged by evidence selection')
  }
}
const interpretations: Array<[string, Row]> = [
  ['property details', { property: { operation: 'details', reference_kind: 'followup', query_scope: 'selected', filters: {}, unit_numbers: ['602'] } }],
  ['property comparison', { property: { operation: 'compare', reference_kind: 'comparison', query_scope: 'comparison', filters: {}, unit_numbers: ['602', '601'] } }],
  ['catalogue details', { catalog_request: { purpose: 'details', requirements: [], semantic_preferences: [] } }],
  ['catalogue comparison', { catalog_request: { purpose: 'compare', requirements: [], semantic_preferences: [] } }],
  ['housing evaluation', { housing_quantities: [{ dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'unspecified',
    evidence: '¿Podemos organizarnos en tres dormitorios?', confidence: 'high' }] }],
  ['qualitative preference', { catalog_request: { purpose: 'search', requirements: [], semantic_preferences: ['acceso cómodo para la familia'] } }],
]
for (const [name, interpretation] of interpretations) test('interpreted ' + name + ' retains complete facility evidence through sequential and repeated projections', () => {
  const verified = context(interpretation), original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), true)
  const semantic = semanticCatalogContext(verified, audit, current)
  const task = taskVerifiedContext(semantic, audit, current)
  const repeatedTask = taskVerifiedContext(task, audit, current)
  const repeatedSemantic = semanticCatalogContext(repeatedTask, audit, current)
  for (const projected of [semantic, task, repeatedTask, repeatedSemantic]) {
    assert.deepEqual(projected.instalaciones, facilities, 'Relevant features include their original restrictions')
    assert.deepEqual(projected.catalogo, original.catalogo, 'Supplementary selection does not expand or replace the catalogue')
    assertProtectedState(projected, original)
  }
  assert.deepEqual(verified, original, 'Neither projection mutates the source context')
})

test('current feature constraints and the chosen 602 remain separate from supplementary project facilities', () => {
  const requirement = { field: 'spaces', operator: 'contains', value: 'Terraza', upper_value: null, strength: 'required', evidence: 'Necesito una terraza' }
  const verified = context({ catalog_request: { purpose: 'details', requirements: [requirement], semantic_preferences: [] } })
  const original = structuredClone(verified)
  const projected = taskVerifiedContext(semanticCatalogContext(verified, audit, current), audit, current)
  assert.deepEqual(object(object(projected.semantica_turno).catalog_request).requirements, [requirement])
  assert.deepEqual(object(projected.property_context).selected_ids, ['p602'])
  assert.deepEqual(object(object(projected.property_context).query).requirements, object(object(original.property_context).query).requirements)
  assert.deepEqual(projected.instalaciones, facilities)
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

test('a financing-only question keeps the selected unit and entry without retaining unrelated facilities or the whole catalogue', () => {
  const message = '¿Qué documentos pide el banco?', verified = context()
  verified.contrato_turno = { objective: 'ask_financing', requests: [{ domain: 'financing', request: message, evidence: message, confidence: 'high' }] }
  object(verified.semantica_turno).primary_intent = 'ask_financing'
  object(verified.semantica_turno).property = { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] }
  const original = structuredClone(verified), financeAudit = { ...audit, source: 'financing_guidance' }
  assert.equal(needsSupplementaryFeatures(verified), false)
  const semantic = semanticCatalogContext(verified, financeAudit, message)
  const projected = taskVerifiedContext(semantic, financeAudit, message)
  assert.deepEqual(semantic.instalaciones, [])
  assert.deepEqual(projected.instalaciones, [])
  assert.equal(object(projected.prompt_context_selection).task, 'financing')
  assert.deepEqual((projected.catalogo as Row[]).map(unit => unit.id), ['p602'])
  assertProtectedState(projected, original)
  assert.match(String(object(projected.catalog_context_scope).note), /No es una búsqueda vacía ni acredita falta de disponibilidad/)
  assert.deepEqual(verified, original)
})

test('an unrelated total-budget update does not activate facility evidence or rewrite a saved entry and selection', () => {
  const message = 'Ahora mi presupuesto total es de 300 mil', verified = context()
  verified.contrato_turno = { objective: 'discuss_budget', requests: [{ domain: 'financing', request: message, evidence: message, confidence: 'high' }] }
  Object.assign(object(verified.semantica_turno), { primary_intent: 'discuss_budget',
    property: { operation: 'none', reference_kind: 'none', filters: {}, unit_numbers: [] },
    budget: { status: 'maximum_total', amount: 300000, evidence: message, confidence: 'high' } })
  const original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), false)
  const projected = taskVerifiedContext(semanticCatalogContext(verified, audit, message), audit, message)
  assert.deepEqual(projected.instalaciones, [])
  assert.deepEqual(projected.catalogo, original.catalogo, 'Budget evidence selection cannot create additional catalogue entries')
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

test('unknown features stay unknown instead of turning an empty projection into factual absence', () => {
  const verified = context({ property: { operation: 'details', reference_kind: 'followup', query_scope: 'selected', filters: {}, unit_numbers: ['602'] } })
  verified.instalaciones = []
  const message = '¿Se permiten mascotas en esa unidad?', original = structuredClone(verified)
  const semantic = semanticCatalogContext(verified, audit, message)
  const projected = taskVerifiedContext(semantic, audit, message)
  assert.deepEqual(projected.instalaciones, [])
  assert.deepEqual(projected.politicas_negocio, [])
  assert.match(String(object(semantic.prompt_context_selection).note), /no acreditan inexistencia/)
  assert.match(String(object(projected.prompt_context_selection).note), /no acreditan inexistencia/)
  assert.deepEqual(projected.catalogo, original.catalogo)
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

test('household context without evaluation does not itself preserve the entire supplementary block', () => {
  for (const quantity of [
    { dimension: 'people', values: [6], role: 'context', count_basis: 'total', evidence: 'Somos seis', confidence: 'high' },
    { dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'unspecified', evidence: 'tres dormitorios', confidence: 'low' },
  ]) {
    const verified = context({ primary_intent: 'discuss_budget', housing_quantities: [quantity] })
    verified.contrato_turno = { objective: 'discuss_budget', requests: [{ domain: 'financing',
      request: 'Tengo una duda sobre el presupuesto', evidence: 'Tengo una duda sobre el presupuesto', confidence: 'high' }] }
    assert.equal(needsSupplementaryFeatures(verified), false)
    assert.deepEqual(semanticCatalogContext(verified, audit, 'Tengo una duda sobre el presupuesto').instalaciones, [])
  }
})


test('a financing route cannot discard feature evidence needed by another interpreted request in the same turn', () => {
  const finance = '¿Qué documentos pide el banco?', message = current + ' ' + finance
  const verified = context({ property: { operation: 'details', reference_kind: 'followup', query_scope: 'selected', filters: {}, unit_numbers: ['602'] } })
  object(verified.contrato_turno).requests = [
    { domain: 'property', request: current, evidence: current, confidence: 'high' },
    { domain: 'financing', request: finance, evidence: finance, confidence: 'high' },
  ]
  const original = structuredClone(verified), financeAudit = { ...audit, source: 'financing_guidance' }
  const projected = taskVerifiedContext(semanticCatalogContext(verified, financeAudit, message), financeAudit, message)
  assert.equal(object(projected.prompt_context_selection).task, 'multiple_requests')
  assert.deepEqual(projected.instalaciones, facilities)
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})


function initialInformationContext(message: string, requests?: Row[]): Row {
  const verified = context({ property: { operation: 'none', reference_kind: 'none', query_scope: null, filters: {}, unit_numbers: [] } })
  verified.contrato_turno = { objective: 'project_information', requests: requests || [
    { domain: 'property', request: message, evidence: message, confidence: 'high', source: 'current' },
  ] }
  const profileQuestion = { id: 'lead_profile', act: 'profile', question: '¿Cuál es su nombre y dónde reside?', target_ids: [], candidate_ids: [] }
  verified.property_context = { version: 2, query: {}, selected_ids: [], offered_ids: [], comparison_ids: [], focused_ids: [], pending_question: profileQuestion }
  verified.siguiente_paso_comercial = { action: 'introduction', question_id: profileQuestion.id, question: profileQuestion.question }
  verified.financing_amounts = []
  verified.etapa_financiamiento = { selected_unit_id: null, consent_required: true, requested_fields: [] }
  verified.financiamiento = { current: { explicit_consent: false, unit_id: null } }
  return verified
}

for (const message of [
  'Tengo movilidad reducida, ¿cómo es el acceso al edificio?',
  'Me interesa conocer las condiciones del edificio.',
]) test('an initial interpreted property question retains full features without an active unit: ' + message, () => {
  const verified = initialInformationContext(message), original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), true)
  const semantic = semanticCatalogContext(verified, audit, message)
  const task = taskVerifiedContext(semantic, { ...audit, source: 'project_overview' }, message)
  const repeated = taskVerifiedContext(task, { ...audit, source: 'project_overview' }, message)
  for (const projected of [semantic, task, repeated]) {
    assert.deepEqual(projected.instalaciones, facilities, 'Feature restrictions survive without a technical keyword')
    assert.deepEqual(object(projected.property_context).selected_ids, [])
    assert.deepEqual(object(projected.property_context).query, {})
    assert.deepEqual(object(object(projected.semantica_turno).property).filters, {})
    assert.deepEqual(object(object(projected.semantica_turno).catalog_request).requirements, [])
    assert.deepEqual(object(object(projected.semantica_turno).catalog_request).semantic_preferences, [])
    assert.equal(object(object(projected.financiamiento).current).explicit_consent, false)
    assertProtectedState(projected, original)
  }
  assert.deepEqual(verified, original, 'Evidence selection leaves the initial source and all permissions unchanged')
})

test('a compound initial property and financing question retains features while project information remains primary', () => {
  const propertyQuestion = 'Tengo movilidad reducida, ¿cómo es el acceso al edificio?', financeQuestion = '¿Con qué bancos trabajan?'
  const message = propertyQuestion + ' ' + financeQuestion
  const verified = initialInformationContext(message, [
    { domain: 'property', request: propertyQuestion, evidence: propertyQuestion, confidence: 'high', source: 'current' },
    { domain: 'financing', request: financeQuestion, evidence: financeQuestion, confidence: 'high', source: 'current' },
  ])
  const original = structuredClone(verified), financeAudit = { ...audit, source: 'financing_guidance' }
  assert.equal(needsSupplementaryFeatures(verified), true)
  const projected = taskVerifiedContext(semanticCatalogContext(verified, financeAudit, message), financeAudit, message)
  assert.equal(object(projected.prompt_context_selection).task, 'multiple_requests')
  assert.deepEqual(projected.instalaciones, facilities)
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

for (const [name, requestChanges, semanticChanges] of [
  ['financing-only', { domain: 'financing' }, {}],
  ['courtesy-only', { domain: 'courtesy' }, {}],
  ['unreliable property request', { confidence: 'medium' }, {}],
  ['unreliable primary intent', {}, { confidence: 'medium' }],
  ['pending request without a current property question', { source: 'pending', source_message_id: 'old-question' }, {}],
  ['request without supporting evidence', { evidence: '' }, {}],
] as Array<[string, Row, Row]>) test('initial feature retention excludes ' + name, () => {
  const message = '¿Cómo funciona este proceso?'
  const verified = initialInformationContext(message, [
    { domain: 'property', request: message, evidence: message, confidence: 'high', source: 'current', ...requestChanges },
  ])
  Object.assign(object(verified.semantica_turno), semanticChanges)
  const original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), false)
  const projected = taskVerifiedContext(semanticCatalogContext(verified, audit, message), audit, message)
  assert.deepEqual(projected.instalaciones, [])
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

test('the canonical financing domain overrides an identical unreconciled property request', () => {
  const message = '¿Cómo funciona este proceso?', verified = initialInformationContext(message, [
    { domain: 'financing', request: message, evidence: message, confidence: 'high', source: 'current' },
  ])
  verified.solicitudes_interpretadas = [
    { domain: 'property', request: message, evidence: message, confidence: 'high' },
  ]
  const original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), false)
  assert.deepEqual(semanticCatalogContext(verified, audit, message).instalaciones, [])
  assert.deepEqual(verified, original)
})

test('a reliable interpreted current property request works when the shared contract has no request inventory', () => {
  const message = '¿Cómo es el acceso al edificio?', verified = initialInformationContext(message, [])
  verified.solicitudes_interpretadas = [
    { domain: 'property', request: message, evidence: message, confidence: 'high', source: 'current' },
  ]
  const original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), true)
  assert.deepEqual(taskVerifiedContext(semanticCatalogContext(verified, audit, message), audit, message).instalaciones, facilities)
  assert.deepEqual(verified, original)
})

const verifiedElevators: Row = { category: 'seguridad_confort', amenity_name: '2 ascensores de última generación',
  description: 'Ascensores modernos y eficientes', access_condition: 'Disponibilidad sujeta a mantenimiento.' }
const verifiedRamp: Row = { amenity_name: 'Rampa de acceso', description: 'Conecta el acceso principal.',
  access_condition: 'La pendiente y los accesos a cada unidad requieren comprobación.' }

function floorSearchContext(message: string): Row {
  const verified = context({ primary_intent: 'property_search',
    property: { operation: 'search', reference_kind: 'followup', query_scope: 'available',
      filters: { floor_number: 0 }, unit_numbers: [] },
    catalog_request: { purpose: 'search', requirements: [], semantic_preferences: [] } })
  verified.contrato_turno = { objective: 'property_search', requests: [
    { domain: 'property', request: message, evidence: message, confidence: 'high', source: 'current' },
  ] }
  verified.instalaciones = [structuredClone(verifiedElevators), structuredClone(verifiedRamp), facilities[1], facilities[2]]
  return verified
}

for (const message of [
  'Entiendo, creo que en una planta baja me gustaría más para no subir tantas gradas',
  'Prefiero un piso bajo porque me cuesta subir escaleras',
  'Tengo movilidad reducida, prefiero algo en niveles bajos',
  'Uso silla de ruedas, ¿qué opciones puedo revisar?',
  'Me resulta difícil caminar y quiero un acceso cómodo',
  'Mi madre utiliza un andador y buscamos tres dormitorios',
]) test('implicit current access need retains verified elevators and access restrictions in every projection: ' + message, () => {
  const verified = floorSearchContext(message), original = structuredClone(verified)
  assert.equal(needsSupplementaryFeatures(verified), false, 'The actual extraction has no semantic preference or evaluation')
  const semantic = semanticCatalogContext(verified, audit, message)
  const task = taskVerifiedContext(semantic, audit, message)
  const repeated = taskVerifiedContext(semanticCatalogContext(task, audit, message), audit, message)
  for (const projected of [semantic, task, repeated]) {
    assert.deepEqual(projected.instalaciones, [verifiedElevators, verifiedRamp], 'Keep access facts whole without unrelated amenities')
    assert.deepEqual(object(object(projected.semantica_turno).catalog_request).semantic_preferences, [])
    assertProtectedState(projected, original)
  }
  assert.deepEqual(verified, original, 'Need reasoning never selects a category, floor or unit')
})

test('an access need without verified access features leaves them unknown and never invents an elevator', () => {
  const message = 'Me gustaría una planta baja para evitar las gradas', verified = floorSearchContext(message)
  verified.instalaciones = [facilities[1], facilities[2]]
  const original = structuredClone(verified)
  const projected = taskVerifiedContext(semanticCatalogContext(verified, audit, message), audit, message)
  assert.deepEqual(projected.instalaciones, [])
  assert.match(String(object(projected.prompt_context_selection).note), /no acreditan inexistencia/)
  assertProtectedState(projected, original)
  assert.deepEqual(verified, original)
})

for (const message of ['Prefiero la segunda planta', 'Tengo tres hijos', 'Soy mayor de edad', 'Mi presupuesto es de 300 mil']) {
  test('ordinary preferences and age do not create an unsupported mobility need: ' + message, () => {
    const verified = floorSearchContext(message), original = structuredClone(verified)
    const projected = taskVerifiedContext(semanticCatalogContext(verified, audit, message), audit, message)
    assert.deepEqual(projected.instalaciones, [])
    assertProtectedState(projected, original)
    assert.deepEqual(verified, original)
  })
}

test('past mobility in remembered profile or a stale request cannot activate current access evidence', () => {
  const message = '¿Qué documentos se necesitan para el banco?', verified = floorSearchContext(message)
  verified.perfil_lead = { notes: 'Tengo movilidad reducida y prefiero evitar gradas' }
  verified.historial = [{ role: 'cliente', content: 'Tengo movilidad reducida y prefiero evitar gradas' }]
  verified.solicitudes_interpretadas = [{ domain: 'property', request: 'Quiero evitar gradas', evidence: 'Quiero evitar gradas',
    confidence: 'high', source: 'pending', source_message_id: 'old-message' }]
  assert.deepEqual(supplementaryFeatureFacts(verified, message, []), [])
})
