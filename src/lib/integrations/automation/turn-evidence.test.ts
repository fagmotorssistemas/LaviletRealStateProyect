import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeReviewReferences, replyReferences, sentenceReferenceReviewSchema, verifiedClaimSources, draftNumericCandidates } from './turn-evidence'
import { claimSchema, factualValuesSchema, factualValueIssues, reviewClaims, reviewRepairCoverageIssues } from './semantic-review'
import { object, type Row } from './data'
import { checkReviewDecision, reviewChecks, reviewIssuesSchema } from './turn-review-checks'
import { validateCatalogReply } from './catalog-dialogue'

test('CRM names cannot become identity evidence but a persisted declaration can', () => {
  const lead = { name: 'Nombre del WhatsApp', full_name: 'Nombre del CRM', preferred_category: 'departamento' }
  const unconfirmed = verifiedClaimSources({ lead, perfil_lead: { full_name: 'Nombre sin procedencia' } }, {}, {}, 'Buenas tardes')
  assert.doesNotMatch(JSON.stringify(unconfirmed), /Nombre del WhatsApp|Nombre del CRM|Nombre sin procedencia/)
  const confirmed = verifiedClaimSources({ lead, perfil_lead: { full_name: 'Ana María',
    sources: { full_name: { source: 'lead_declaration', evidence: 'Me llamo Ana María', message_id: 'name-1' } } } }, {}, {}, 'Quiero información')
  const nameSource = confirmed.find(source => source.path === 'contexto_verificado.perfil_lead')
  assert.equal((nameSource?.value as { full_name: string }).full_name, 'Ana María')
  assert.doesNotMatch(JSON.stringify(confirmed), /Nombre del WhatsApp|Nombre del CRM/)
})

test('configured brochure and unit tours have factual evidence without claiming delivery or accepting history URLs', () => {
  const sources = verifiedClaimSources({ history: [{ content: 'https://untrusted.example/file' }] }, {
    profile_introduction: { brochure_url: 'https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf' },
    unit_model: { unit_number: '605', url: 'https://www.lavilett.com/tour/605' },
  }, {}, 'Comparta el recorrido')
  const materials = sources.filter(source => ['materiales_configurados.brochure', 'estado_operativo.unit_model'].includes(source.path))
  assert.equal(materials.length, 2)
  assert.ok(materials.every(source => source.kind === 'project_fact'))
  assert.equal(JSON.stringify(sources).includes('untrusted.example'), false)
  assert.equal(sources.some(source => source.kind === 'operational_fact'), false)
})

test('an abbreviated reviewer citation resolves to its unique literal sentence', () => {
  const reply = 'Los departamentos de tres dormitorios ofrecen 120.83 m² de área interior y 27.03 m² de balcón, todos con dos baños completos.'
  const unit = { id: 'unit-1', unit_number: '202', area_exterior_m2: 27.03 }
  const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null,
    fragment: 'departamentos de tres dormitorios ofrecen ... 27.03 m² de balcón' }
  const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
  assert.equal((result.review.factual_values as typeof fact[])[0].fragment, reply)
  assert.deepEqual(factualValueIssues(result.review.factual_values, reply, [unit]), [])
  assert.equal(result.corrections[0].code, 'abbreviated_sentence_reference_resolved')
})

test('an ambiguous or invented abbreviation cannot repair reviewer evidence', () => {
  const reply = 'La suite tiene 27.03 m² de balcón. Otra suite tiene 27.03 m² de balcón.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  for (const fragment of ['suite tiene ... 27.03 m² de balcón', 'suite tiene ... 99.99 m² de balcón']) {
    const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null, fragment }
    const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
    assert.equal((result.review.factual_values as typeof fact[])[0].fragment, fragment)
    assert.equal(factualValueIssues(result.review.factual_values, reply, [unit])[0].code, 'review_fragment_not_in_reply')
  }
})

test('a paraphrased reviewer fragment resolves regardless of the writer word order', () => {
  const reply = 'El balcón tiene 27.03 metros cuadrados y el área interior tiene 120.83 metros cuadrados.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null,
    fragment: 'La superficie exterior mide 27.03 m²' }
  const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
  assert.equal((result.review.factual_values as typeof fact[])[0].fragment, reply)
  assert.equal(result.corrections[0].code, 'unique_numeric_sentence_reference_resolved')
  assert.deepEqual(factualValueIssues(result.review.factual_values, reply, [unit]), [])
  assert.equal(validateCatalogReply(reply, {
    verified_catalog: true,
    catalog_results: { units: [{ ...unit, unit_number: '202', category: 'departamento', area_internal_m2: 120.83 }] },
    semantic_review: { ...result.review, status: 'checked' },
  }).valid, true)
})

test('a reviewer citation with a contradictory number is not anchored to a real sentence', () => {
  const reply = 'El balcón tiene 27.03 metros cuadrados.'
  const unit = { id: 'unit-1', area_exterior_m2: 27.03 }
  for (const fragment of ['El balcón tiene 99.99 metros cuadrados.', 'El balcón tiene 27.03 y 99.99 metros cuadrados.']) {
    const fact = { unit_id: unit.id, field: 'area_exterior_m2', value: 27.03, operator: 'eq', upper_value: null, fragment }
    const result = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
    assert.equal((result.review.factual_values as typeof fact[])[0].fragment, fact.fragment)
    assert.equal(factualValueIssues(result.review.factual_values, reply, [unit])[0].code, 'review_fragment_not_in_reply')
  }
})

test('live reviewer schema accepts only the current draft sentence IDs without mutating historical schemas', () => {
  const schema = { type: 'object', additionalProperties: false,
    properties: { claims: claimSchema, factual_values: factualValuesSchema, answers_supported: { type: 'boolean' } },
    required: ['claims', 'factual_values', 'answers_supported'] }
  const original = JSON.stringify(schema)
  const first = sentenceReferenceReviewSchema(schema, 'Buenas tardes. La Vilet se ubica en Cuenca.')
  for (const field of ['claims']) {
    const list = object(object(first.properties)[field]), item = object(list.items)
    assert.deepEqual(object(item.properties).fragment, { type: 'string', enum: ['S1', 'S2'] })
    assert.ok((item.required as string[]).includes('fragment'))
    assert.equal(item.additionalProperties, false)
  }
  assert.equal(object(object(first.properties).factual_values).maxItems, 0)
  assert.deepEqual(first.required, schema.required)
  assert.equal(JSON.stringify(schema), original)
  const next = sentenceReferenceReviewSchema(schema, 'La Vilet se ubica en Cuenca.')
  assert.deepEqual(object(object(object(object(next.properties).claims).items).properties).fragment,
    { type: 'string', enum: ['S1'] })
  const empty = sentenceReferenceReviewSchema(schema, '')
  assert.equal(object(object(empty.properties).claims).maxItems, 0)
})

test('numeric review of foreign residence cannot invent catalogue areas or read a brochure version as an area', () => {
  const reply = 'Mucho gusto, Carlos. Residir fuera de Ecuador no representa una limitación para revisar información. Puede recibir una guía personalizada: https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf.'
  assert.deepEqual(draftNumericCandidates(reply), [])
  const schema = sentenceReferenceReviewSchema({ properties: { factual_values: factualValuesSchema } }, reply)
  assert.equal(object(object(schema.properties).factual_values).maxItems, 0)
})

test('numeric candidates preserve prose variants and constrain each sentence to its own values', () => {
  const reply = 'El balcón tiene 27,03 metros cuadrados y el interior 120.83 m2. Tiene tres dormitorios y dos baños, en la sexta planta. Su valor va desde 145 mil hasta quinientos cincuenta mil dólares.'
  const candidates = draftNumericCandidates(reply)
  assert.deepEqual(candidates, [
    { sentence_id: 'S1', values: [27.03, 120.83] },
    { sentence_id: 'S2', values: [3, 2, 6] },
    { sentence_id: 'S3', values: [145000, 550000] },
  ])
  const schema = sentenceReferenceReviewSchema({ properties: { factual_values: factualValuesSchema } }, reply)
  const branches = object(object(object(schema.properties).factual_values).items).anyOf as Row[]
  for (const [index, branch] of branches.entries()) {
    const properties = object(branch.properties)
    assert.deepEqual(properties.fragment, { type: 'string', enum: [candidates[index].sentence_id] })
    assert.deepEqual(properties.value, { type: 'number', enum: candidates[index].values })
    assert.equal(branch.additionalProperties, false)
    assert.deepEqual(branch.required, factualValuesSchema.items.required)
  }
  assert.deepEqual(draftNumericCandidates('Una habitación y un baño. Área: veintisiete coma cero tres metros cuadrados.'), [
    { sentence_id: 'S1', values: [1] }, { sentence_id: 'S2', values: [27.03] },
  ])
})

test('numbers mentioned by the writer still fail when they contradict the catalogue or describe a family', () => {
  const unit = { id: 'unit-1', area_internal_m2: 72.18, bedrooms: 3 }
  const reply = 'La superficie interior es 99.99 m².'
  const schema = sentenceReferenceReviewSchema({ properties: { factual_values: factualValuesSchema } }, reply)
  const branches = object(object(object(schema.properties).factual_values).items).anyOf as Row[]
  assert.deepEqual(object(branches[0].properties).value, { type: 'number', enum: [99.99] })
  const fact = { fragment: 'S1', unit_id: unit.id, field: 'area_internal_m2', value: 99.99, operator: 'eq', upper_value: null }
  const normalized = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply)
  assert.equal(factualValueIssues(normalized.review.factual_values, reply, [unit])[0].code, 'catalog_value_mismatch')
  const family = 'Su familia tiene tres personas.'
  const wrong = normalizeReviewReferences({ factual_values: [{ ...fact, field: 'bedrooms', value: 3 }] }, [unit], family)
  assert.equal(factualValueIssues(wrong.review.factual_values, family, [unit])[0].code, 'numeric_field_not_in_reply')
})

test('reviewer selects the welcome sentence instead of reformulating it and facts remain independently grounded', () => {
  const sentence = 'Le doy la bienvenida a La Vilet, un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca.'
  const reply = `Buenas tardes. ${sentence} ¿Cuál es su nombre?`
  const source = { id: 'E1', kind: 'project_fact', path: 'contexto_verificado.proyecto', value: 'La Vilet, Puertas del Sol, Cuenca.' }
  const entry = { fragment: 'S2', subject: 'Ubicación de La Vilet', polarity: 'affirmation', claim_kind: 'project_fact',
    verdict: 'supported', evidence: 'La ubicación consta en el contexto verificado.', evidence_source: 'verified_context', evidence_ids: ['E1'] }
  const normalized = normalizeReviewReferences({ claims: [entry] }, [], reply)
  const claims = normalized.review.claims as Row[]
  assert.equal(claims[0].fragment, sentence)
  assert.equal(reviewClaims(claims, reply, [source]).valid, true)
  assert.equal(replyReferences(reply)[1].text, sentence)
  assert.equal(reviewClaims([{ ...claims[0], evidence_ids: ['E999'] }], reply, [source]).valid, false)
  // Historical literal references still work; paraphrases do not certify text.
  assert.equal(reviewClaims([{ ...entry, fragment: sentence }], reply, [source]).valid, true)
  const paraphrase = { ...entry, fragment: 'La Vilet es un proyecto de uso mixto ubicado en Puertas del Sol, Cuenca.' }
  assert.equal(reviewClaims([paraphrase], reply, [source]).issues[0].code, 'claim_fragment_not_in_reply')
})

test('invented sentence IDs cannot fall back to a matching number or literal mention of the ID', () => {
  const reply = 'La referencia S99 tiene 99 metros cuadrados.'
  const unit = { id: 'unit-1', area_internal_m2: 99 }
  const fact = { fragment: 'S99', unit_id: unit.id, field: 'area_internal_m2', value: 99, operator: 'eq', upper_value: null }
  const claim = { fragment: 'S99', subject: 'Área', polarity: 'affirmation', claim_kind: 'project_fact',
    verdict: 'supported', evidence: 'Área verificada.', evidence_source: 'verified_context', evidence_ids: ['E1'] }
  const result = normalizeReviewReferences({ factual_values: [fact], claims: [claim] }, [unit], reply)
  assert.equal(result.corrections.length, 0)
  assert.equal(factualValueIssues(result.review.factual_values, reply, [unit])[0].code, 'review_fragment_not_in_reply')
  assert.equal(reviewClaims(result.review.claims, reply, [{ id: 'E1', kind: 'project_fact' }]).issues[0].code,
    'claim_fragment_not_in_reply')
})

test('sentence IDs preserve catalogue validation and cannot hide a false price during metadata repair', () => {
  const reply = 'El departamento 202 cuesta $250.000 USD.'
  const unit = { id: 'unit-202', unit_number: '202', published_commercial_price: 210000 }
  const fact = { fragment: 'S1', unit_id: unit.id, field: 'published_commercial_price', value: 250000, operator: 'eq', upper_value: null }
  const first = normalizeReviewReferences({ factual_values: [fact] }, [unit], reply).review
  assert.equal(factualValueIssues(first.factual_values, reply, [unit])[0].code, 'catalog_value_mismatch')
  const deleted = normalizeReviewReferences({ factual_values: [] }, [unit], reply).review
  assert.equal(reviewRepairCoverageIssues(first, deleted, reply, [unit])[0].code, 'review_repair_omitted_facts')
})

test('all reviewer defect references use IDs and source is assigned by code even without factual review', () => {
  const reply = 'Buenas tardes. ¿podría indicar su nombre?', current = 'Estoy interesado.'
  for (const includeFacts of [false, true]) {
    const schema = { type: 'object', additionalProperties: false, properties: {
      review_issues: reviewIssuesSchema, ...(includeFacts ? { claims: claimSchema, factual_values: factualValuesSchema } : {}),
    }, required: ['review_issues', ...(includeFacts ? ['claims', 'factual_values'] : [])] }
    const original = JSON.stringify(schema)
    const result = sentenceReferenceReviewSchema(schema, reply, current)
    const item = object(object(object(result.properties).review_issues).items)
    assert.deepEqual(object(item.properties).fragment, { type: 'string', enum: ['S1', 'S2', 'R1'] })
    assert.equal(object(item.properties).source, undefined)
    assert.equal((item.required as string[]).includes('source'), false)
    assert.deepEqual(new Set(item.required as string[]), new Set(Object.keys(object(item.properties))))
    assert.equal(JSON.stringify(schema), original)
    if (includeFacts) assert.deepEqual(object(object(object(object(result.properties).claims).items).properties).fragment,
      { type: 'string', enum: ['S1', 'S2'] })
  }
  const raw = { review_issues: [{ check: 'question_has_purpose', kind: 'editorial', fragment: 'S2',
    source: 'current_request', reason: 'Podría usar otro orden para la pregunta.' }] }
  const result = normalizeReviewReferences(raw, [], reply, current)
  const issue = (result.review.review_issues as Row[])[0]
  assert.equal(issue.source, 'draft')
  assert.equal(issue.fragment, '¿podría indicar su nombre?')
  assert.equal(raw.review_issues[0].fragment, 'S2')
  const decision = checkReviewDecision({ ...Object.fromEntries(reviewChecks.map(check => [check, true])), ...result.review }, current, reply)
  assert.deepEqual(decision.issues, [])
  assert.equal(decision.editorial.length, 1)
})

test('current-request IDs retain real omissions as content defects and invalid IDs cannot prove them', () => {
  const current = 'Quiero conocer el precio.', reply = 'Buenas tardes.'
  const entry = { check: 'all_requests_considered', kind: 'content', fragment: 'R1', reason: 'No responde al precio solicitado.' }
  const flags = Object.fromEntries(reviewChecks.map(check => [check, check !== 'all_requests_considered']))
  const result = normalizeReviewReferences({ ...flags, review_issues: [entry] }, [], reply, current)
  assert.deepEqual((result.review.review_issues as Row[])[0], { ...entry, fragment: current, source: 'current_request' })
  const decision = checkReviewDecision(result.review, current, reply)
  assert.equal(decision.issues[0].kind, 'commercial_content')
  assert.equal(decision.issues[0].code, 'review_check_failed:all_requests_considered')
  for (const fragment of ['R2', 'S99']) {
    const invalid = normalizeReviewReferences({ ...flags, review_issues: [{ ...entry, fragment }] }, [], reply, current)
    assert.equal(checkReviewDecision(invalid.review, current, reply).issues[0].code, 'invalid_review_issue_reference')
  }
  const old = { ...flags, review_issues: [{ ...entry, fragment: current, source: 'current_request' }] }
  assert.deepEqual(normalizeReviewReferences(old, [], reply, current).review.review_issues, old.review_issues)
})
