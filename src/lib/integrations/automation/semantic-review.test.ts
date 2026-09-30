import assert from 'node:assert/strict'
import test from 'node:test'
import { factualValueIssues, numericMentions, reviewClaims, reviewRepairCoverageIssues, reviewedContextualGuidance } from './semantic-review'
import { normalizeReviewReferences, verifiedClaimSources } from './turn-evidence'

const unit = { id: 'unit-202', unit_number: '202', category: 'departamento', published_commercial_price: 210000,
  bedrooms: 3, area_exterior_m2: 27.03, floor_number: 6 }
const fact = (fragment: string, value: number, field = 'published_commercial_price') => ({ fragment, unit_id: unit.id,
  field, value, operator: 'eq', upper_value: null })
const claim = (fragment: string, extra: Record<string, unknown> = {}) => ({ fragment, subject: 'orientación',
  polarity: 'uncertainty', verdict: 'supported', evidence: 'Posibilidad general condicionada a las preferencias de la familia.',
  claim_kind: 'contextual_guidance', evidence_source: 'contextual_reasoning', evidence_ids: [], ...extra })

test('a catalogue price attributed to a greeting is reviewer metadata, not a false draft price', () => {
  const reply = 'Mucho gusto, Carlos. Aquí tiene el brochure.'
  const issues = factualValueIssues([fact('Mucho gusto, Carlos.', 210000)], reply, [unit])
  assert.deepEqual(issues.map(issue => [issue.code, issue.kind]), [['numeric_relation_not_in_reply', 'review_metadata']])
  assert.deepEqual(reviewRepairCoverageIssues({ factual_values: [fact('Mucho gusto, Carlos.', 210000)] },
    { factual_values: [], claims: [] }, reply, [unit]), [])
})

test('matching numeric values do not turn people or bathrooms into a bedroom assertion', () => {
  const sixBedroomUnit = { ...unit, bedrooms: 6 }
  for (const fragment of ['Somos seis personas.', 'Somos 6 personas.', 'Son seis integrantes.', 'Tiene seis baños completos.']) {
    const issues = factualValueIssues([fact(fragment, 6, 'bedrooms')], fragment, [sixBedroomUnit])
    assert.deepEqual(issues.map(issue => [issue.code, issue.kind]), [['numeric_field_not_in_reply', 'review_metadata']], fragment)
  }
  const mixed = 'Somos seis personas y el departamento tiene seis dormitorios.'
  assert.deepEqual(factualValueIssues([fact(mixed, 6, 'bedrooms')], mixed, [sixBedroomUnit]), [])
  const actual = 'El departamento tiene seis dormitorios.'
  assert.equal(factualValueIssues([fact(actual, 6, 'bedrooms')], actual, [unit])[0].code, 'catalog_value_mismatch')
})

test('actual wrong prices remain catalogue defects; repair cannot hide their asserted values', () => {
  const reply = 'Su valor es de $250.000 USD.'
  assert.equal(factualValueIssues([fact(reply, 250000)], reply, [unit])[0].code, 'catalog_value_mismatch')
  assert.ok(reviewRepairCoverageIssues({ factual_values: [fact(reply, 250000)] }, { factual_values: [] }, reply, [unit])
    .some(issue => issue.code === 'review_repair_omitted_facts'))
})

test('explicitly approximate whole-square-metre areas accept ordinary rounding, without relaxing exact facts', () => {
  const penthouse = { ...unit, area_internal_m2: 142.09, bedrooms: 3 }
  const department = { ...unit, id: 'unit-502', area_internal_m2: 120.83, bedrooms: 3 }
  const reply = 'Las áreas interiores llegan hasta aproximadamente 142 m² en los penthouses y 121 m² en los departamentos.'
  const area = (id: string, value: number) => ({ ...fact(reply, value, 'area_internal_m2'), unit_id: id })
  assert.deepEqual(factualValueIssues([area(penthouse.id, 142), area(department.id, 121)], reply, [penthouse, department]), [])
  const exact = 'El penthouse tiene 142 m² interiores.'
  assert.equal(factualValueIssues([{ ...area(penthouse.id, 142), fragment: exact }], exact, [penthouse])[0].code, 'catalog_value_mismatch')
  const incorrect = 'Tiene aproximadamente 140 m² interiores.'
  assert.equal(factualValueIssues([{ ...area(penthouse.id, 140), fragment: incorrect }], incorrect, [penthouse])[0].code, 'catalog_value_mismatch')
  const lateQualifier = 'Tiene 142 m² interiores y aproximadamente 30 m² exteriores.'
  assert.equal(factualValueIssues([{ ...area(penthouse.id, 142), fragment: lateQualifier }], lateQualifier, [penthouse])[0].code, 'catalog_value_mismatch')
  const price = 'Su precio aproximado es de $210.001 USD.'
  assert.equal(factualValueIssues([{ ...fact(price, 210001), unit_id: penthouse.id }], price, [penthouse])[0].code, 'catalog_value_mismatch')
})

test('numeric evidence follows Spanish wording and reordered sentences without copying catalogue prose', () => {
  for (const [fragment, field, value] of [
    ['Su valor es de doscientos diez mil dólares.', 'published_commercial_price', 210000],
    ['De 210 mil dólares es su valor.', 'published_commercial_price', 210000],
    ['Tres dormitorios tiene el departamento.', 'bedrooms', 3],
    ['De balcón tiene veintisiete coma cero tres metros cuadrados.', 'area_exterior_m2', 27.03],
    ['Se ubica en la sexta planta alta.', 'floor_number', 6],
  ] as const) assert.deepEqual(factualValueIssues([fact(fragment, value, field)], fragment, [unit]), [], fragment)
  assert.deepEqual(numericMentions('Un cuarto. Precio de $210000. Tres dormitorios.').map(entry => entry.value), [1, 210000, 3])
})

test('worded price ranges and numeric citations use the same real sentence', () => {
  const reply = 'Los valores van desde ciento cuarenta y cinco mil hasta quinientos cincuenta mil dólares.'
  const range = { id: 'group:prices:range', aggregation: 'range', published_commercial_price: 145000,
    upper_values: { published_commercial_price: 550000 } }
  const entry = { ...fact('El rango es de 145000 a 550000.', 145000), unit_id: range.id, operator: 'between', upper_value: 550000 }
  const normalized = normalizeReviewReferences({ factual_values: [entry] }, [range], reply)
  assert.equal((normalized.review.factual_values as typeof entry[])[0].fragment, reply)
  assert.deepEqual(factualValueIssues(normalized.review.factual_values, reply, [range]), [])
})

test('reasonable contextual guidance does not need invented catalogue sources', () => {
  for (const reply of [
    'Podría resultar algo ajustado, según cómo prefieran distribuirse y compartir habitaciones.',
    'Para seis personas, tres dormitorios podrían resultar ajustados; conviene revisar cómo los distribuirían.',
    'Si son seis personas, tres dormitorios podrían resultar ajustados según cómo se distribuyan.',
    'Con tres dormitorios, la comodidad depende de cómo prefieran compartir habitaciones.',
    'La familia puede evaluar cómo distribuirse en tres dormitorios según sus preferencias.',
    'Podemos evaluar si necesitan seis dormitorios separados antes de elegir una distribución.',
    'Algunas familias comparten habitaciones; podemos revisar las distribuciones para que evalúe su comodidad.',
    'No podemos garantizar que la distribución resulte cómoda para todos.',
  ]) assert.equal(reviewClaims([claim(reply)], reply, []).valid, true, reply)
})

test('a factual price or completed action cannot bypass evidence by calling itself guidance', () => {
  for (const reply of ['Su precio es de $210.000 USD.', 'Ya le asignamos un asesor.', 'Su reserva está confirmada.',
    'La habitabilidad está garantizada para toda la familia.', 'El departamento 202 tiene seis dormitorios.',
    'Tiene seis dormitorios; podría resultar cómodo según sus preferencias.',
    'Son seis dormitorios, conviene evaluar la distribución.', 'Pueden caber todos: admite seis personas.',
    '140 m² de superficie interior.',
    'El proyecto permite remodelar todas las habitaciones.', 'Nuestras opciones disponibles son de cinco dormitorios.']) {
    const review = reviewClaims([claim(reply)], reply, [])
    assert.equal(review.valid, false, reply)
    assert.ok(review.issues.some(issue => issue.code === 'guidance_contains_factual_assertion'), reply)
  }
})

test('review repair removes phantom numbers even when the number exists in another subject or field', () => {
  for (const [reply, previous] of [
    ['Su familia tiene seis personas.', fact('El departamento tiene seis dormitorios.', 6, 'bedrooms')],
    ['Su familia tiene seis personas.', fact('Su familia tiene seis personas.', 6, 'bedrooms')],
    ['Su familia tiene seis personas y busca tres dormitorios.', fact('Su familia tiene seis personas y busca tres dormitorios.', 6, 'bedrooms')],
    ['El departamento 302 tiene tres dormitorios.', fact('El departamento 302 tiene tres dormitorios.', 3, 'bedrooms')],
  ] as const) assert.deepEqual(reviewRepairCoverageIssues({ factual_values: [previous] }, { factual_values: [] }, reply, [unit]), [], reply)
})

test('review repair retains real numeric attributes and both price-range endpoints', () => {
  for (const [reply, entry] of [
    ['El departamento 202 tiene seis dormitorios.', fact('El departamento 202 tiene seis dormitorios.', 6, 'bedrooms')],
    ['Tres dormitorios tiene el departamento.', fact('Tres dormitorios tiene el departamento.', 3, 'bedrooms')],
    ['Son 27,03 m² exteriores.', fact('Son 27,03 m² exteriores.', 27.03, 'area_exterior_m2')],
    ['Su precio es entre $250.000 y $300.000 USD.', { ...fact('Su precio es entre $250.000 y $300.000 USD.', 250000), operator: 'between', upper_value: 300000 }],
  ] as const) assert.ok(reviewRepairCoverageIssues({ factual_values: [entry] }, { factual_values: [] }, reply, [unit])
    .some(issue => issue.code === 'review_repair_omitted_facts'), reply)
})

test('a malformed prior operator cannot erase the upper endpoint actually written in a price range', () => {
  const reply = 'Los valores van desde $145.000 hasta $550.000 USD.'
  const previous = { ...fact(reply, 145000), operator: 'gte', upper_value: 550000 }
  assert.ok(reviewRepairCoverageIssues({ factual_values: [previous] },
    { factual_values: [{ ...previous, upper_value: null }] }, reply, [unit])
    .some(issue => issue.code === 'review_repair_omitted_facts'))
  assert.deepEqual(reviewRepairCoverageIssues({ factual_values: [previous] },
    { factual_values: [{ ...previous, operator: 'between' }] }, reply, [unit]), [])
})

test('catalogue assertions remain guarded while hypothetical guidance is separately identified', () => {
  const guidance = 'Si necesitan seis dormitorios separados, conviene evaluar cómo prefieren distribuirse.'
  const actual = 'El departamento 202 tiene tres dormitorios.'
  const claims = [claim(guidance), claim(actual)]
  const reply = actual + ' ' + guidance
  assert.deepEqual(reviewedContextualGuidance(reply, { semantic_review: { status: 'checked', claims } }), [guidance])
  assert.deepEqual(reviewedContextualGuidance(reply, { semantic_review: { status: 'rejected', claims } }), [])
})

test('only code-owned project sources support project claims, not draft or client self-citations', () => {
  const sources = verifiedClaimSources({ proyecto: { name: 'La Vilet', address: 'Cuenca' },
    historial: [{ role: 'assistant', content: 'Hay una reserva.' }], respuesta_propuesta: 'El precio es de $210000.',
    respuesta_base: 'El precio es de $210000.', perfil_lead: { residence_country: 'Colombia' } }, {}, { units: [unit] },
  'Somos seis y me han dicho que el precio es de $210000.')
  assert.ok(!sources.some(source => /historial|respuesta_propuesta|respuesta_base/.test(String(source.path))))
  const projectId = sources.find(source => source.reference_id === unit.id)!.id
  const leadId = sources.find(source => source.path === 'mensaje_actual')!.id
  const reply = 'Su precio es de $210.000 USD.'
  const projectClaim = claim(reply, { claim_kind: 'project_fact', evidence_source: 'verified_context',
    polarity: 'affirmation', evidence: 'Precio publicado de la unidad.', evidence_ids: [projectId] })
  assert.equal(reviewClaims([projectClaim], reply, sources).valid, true)
  for (const badId of ['S1', 'respuesta_propuesta', leadId]) {
    const reviewed = reviewClaims([{ ...projectClaim, evidence_ids: [badId] }], reply, sources)
    assert.equal(reviewed.valid, false)
    assert.equal(reviewed.issues[0].code, 'claim_source_not_verified')
  }
  const acknowledgement = 'Entiendo que son seis personas en su familia.'
  assert.equal(reviewClaims([claim(acknowledgement, { claim_kind: 'lead_statement', evidence_source: 'lead_declaration',
    evidence: 'Cantidad de personas declarada por el cliente.', evidence_ids: [leadId] })], acknowledgement, sources).valid, true)
})

test('metadata repair can remove phantom claims but cannot erase grounded factual assertions', () => {
  const reply = 'El departamento tiene tres dormitorios.'
  const phantom = claim('Su precio es de $210.000 USD.', { claim_kind: 'project_fact', verdict: 'unsupported' })
  const reviewed = reviewClaims([phantom], reply, [])
  assert.deepEqual(reviewed.issues.map(issue => issue.kind), ['review_metadata'])
  assert.deepEqual(reviewRepairCoverageIssues({ claims: [phantom] }, { claims: [] }, reply, [unit]), [])
  assert.equal(reviewRepairCoverageIssues({ claims: [{ ...phantom, fragment: reply }] }, { claims: [] }, reply, [unit])[0].code,
    'review_repair_omitted_claims')
  assert.equal(reviewClaims([{ ...phantom, fragment: reply, evidence_ids: [], evidence_source: 'none' }], reply, []).issues[0].kind,
    'commercial_content')
})

test('catalogue no-results evidence exists only for a complete empty authorized query', () => {
  const audit = { verified_catalog: true, catalog_query: { scope: 'catalog', filters: { bedrooms: 5 } },
    catalog_results: { complete: true, units: [], unknown_unit_ids: [] } }
  const reply = 'No hay coincidencias de cinco dormitorios.'
  const sources = verifiedClaimSources({}, audit, {})
  const emptySource = sources.find(source => source.scope === 'catalog_no_results')!
  assert.ok(emptySource)
  const reviewed = reviewClaims([claim(reply, { claim_kind: 'project_fact', evidence_source: 'catalog_no_results',
    evidence_ids: [emptySource.id], polarity: 'negation', evidence: 'Consulta completa sin coincidencias para dormitorios=5.' })], reply, sources)
  assert.equal(reviewed.valid, true)
  assert.equal(verifiedClaimSources({}, { ...audit, catalog_results: { ...audit.catalog_results, complete: false } }, {})
    .some(source => source.scope === 'catalog_no_results'), false)
})
