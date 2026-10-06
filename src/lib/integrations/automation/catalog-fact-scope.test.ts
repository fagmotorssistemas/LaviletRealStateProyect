import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import { object, type Row } from './data'
import { catalogQuery } from './catalog-dialogue'
import { catalogFactScope, claimWithinCatalogScope } from './catalog-fact-scope'
import { completeCatalogResult } from './catalog-result'
import { turnEvidence } from './turn-evidence'
import { taskModelEvidence } from './task-context'
import { factFindings, validateBusinessFacts } from './business-facts'
import { businessRiskSchemaForSources, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { completeTurnReply } from './turn-completeness'

// Regression from execution 22085c08 (2026-10-06, commit 4baf9c7): the
// interpreter correctly requested five bedrooms, but the reviewer bound the
// project's 49/36/6/7 counts to the empty five-bedroom search. Synthetic current
// inventory below isolates that scope error without credentials or live calls.
const current = 'O sea yo pensaba algo más como vivienda de 5 dormitorios por que mi familia es numerosa'
const query = catalogQuery({ group: 'residential', scope: 'catalog', operation: 'search', filters: { bedrooms: 5 } })
const inventory = [
  ...Array.from({ length: 36 }, (_, i) => ({ id: `s${i}`, unit_number: `S${i}`, category: 'suite', bedrooms: 1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `d2-${i}`, unit_number: `D2-${i}`, category: 'departamento', bedrooms: 2 })),
  ...Array.from({ length: 7 }, (_, i) => ({ id: `d3-${i}`, unit_number: `D3-${i}`, category: 'departamento', bedrooms: 3 })),
].map(unit => ({ ...unit, status: 'disponible', is_published: true }))
const filter = (field: string, value: number, operator = 'eq', upper_value: number | null = null) => ({ field, operator, value, upper_value })
const scope = (basis = 'query', filters: Row[] = [filter('bedrooms', 5)], category: string | null = null, group: string | null = 'residential') => ({ basis, group, category, filters })
const fact = (subject_id: string, value = 0, scopeValue: Row = scope(), kind = 'catalog_absence'): Row => ({
  statement: 'No disponemos de viviendas de 5 dormitorios.', kind, subject_id, scope: scopeValue,
  field: 'unit_count', value, upper_value: null, relation: 'eq', unit: 'count',
})
function context(catalog: Row[] = inventory, complete = true) {
  const info: Row = { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete },
    catalog_verification_read: { complete }, politica_comercial: { precios_autorizados: true } }
  const result = completeCatalogResult(info, query, { purpose: 'search', requirements: [] })
  const audit: Row = { source: 'catalog_search', verified_catalog: true, semantic_review_enabled: true, business_risk_review_enabled: true,
    catalog_query: query, catalog_retrieval: { optimized: true }, catalog_summary: result.summary,
    catalog_aggregate_groups: result.groups,
    catalog_results: { units: result.units, unit_ids: result.units.map(u => u.id), complete: result.summary.exact_count,
      unknown_unit_ids: result.unknown.map(u => u.id) } }
  const verified = { ...info, catalogo: result.units }
  return { verified, audit, evidence: turnEvidence(verified, audit), result }
}
const emptyId = 'group:catalog_query:all:range'

test('a complete empty search verifies absence and zero without inventing bedroom attributes', () => {
  const { evidence } = context()
  const checks = validateBusinessFacts([fact(emptyId), fact(emptyId, 0, scope(), 'catalog_value')], inventory, evidence.groups, {})
  assert.deepEqual(checks.map(row => row.status), ['verified', 'verified'])
  assert.equal(checks[0].expected, 0)
  const mistakenPositive = { ...fact(emptyId), kind: 'catalog_value', field: 'bedrooms', value: 5 }
  assert.equal(validateBusinessFacts([mistakenPositive], inventory, evidence.groups, {})[0].status, 'unverified')
  assert.equal(validateBusinessFacts([mistakenPositive], inventory, evidence.groups, {})[0].repairable, true)
})

test('recorded global counts bound to the empty search are metadata defects, not false zero contradictions', () => {
  const { evidence } = context()
  const recorded = [
    fact(emptyId, 49, scope('inventory', []), 'catalog_value'),
    fact(emptyId, 36, scope('inventory', [], 'suite'), 'catalog_value'),
    fact(emptyId, 6, scope('inventory', [filter('bedrooms', 2)], 'departamento'), 'catalog_value'),
    fact(emptyId, 7, scope('inventory', [filter('bedrooms', 3)], 'departamento'), 'catalog_value'),
  ]
  const checks = validateBusinessFacts(recorded, inventory, evidence.groups, {})
  assert.ok(checks.every(row => row.status === 'verified' && object(row.source?.reference_repair).asserted_value_used === false))
  const legacy = recorded.map(row => ({ ...row, scope: { ...object(row.scope), basis: 'subject' } }))
  const legacyChecks = validateBusinessFacts(legacy, inventory, evidence.groups, {})
  assert.ok(legacyChecks.every(row => row.status === 'unverified' && row.repairable === true))
  assert.ok(legacyChecks.every(row => row.expected === undefined))
  const ids = ['residential', 'suite', 'departamento:2', 'departamento:3']
  const repaired = recorded.map((row, i) => ({ ...row, subject_id: `group:inventory:${ids[i]}:range` }))
  assert.ok(validateBusinessFacts(repaired, inventory, evidence.groups, {}).every(row => row.status === 'verified'))
  assert.equal(validateBusinessFacts([{ ...repaired[0], value: 48 }], inventory, evidence.groups, {})[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([{ ...recorded[0], value: 48 }], inventory, evidence.groups, {})[0].status, 'contradiction', 'reference recovery cannot pick a group by matching the false value')
})

test('an absence cannot remove any source condition, even when the filtered set is empty', () => {
  const { evidence } = context()
  for (const broad of [scope('query', []), scope('query', [filter('bedrooms', 3)]), scope('alternatives')])
    assert.equal(validateBusinessFacts([fact(emptyId, 0, broad)], inventory, evidence.groups, {})[0].status, 'unverified')
  assert.equal(validateBusinessFacts([fact(emptyId, 0, scope('inventory', []))], inventory, evidence.groups, {})[0].status, 'contradiction')
  assert.equal(validateBusinessFacts([fact(emptyId, 0, scope('inventory'))], inventory, evidence.groups, {})[0].status, 'verified')
  const constrained = catalogFactScope({ group: 'residential', filters: { bedrooms: 5, floor_number: 2, min_area_m2: 120 } })
  assert.equal(claimWithinCatalogScope(scope('query', [filter('bedrooms', 5)]), constrained), false)
  assert.equal(claimWithinCatalogScope(scope('query', [filter('bedrooms', 5), filter('floor_number', 2), filter('area_internal_m2', 140, 'gte')]), constrained), true)
  assert.equal(claimWithinCatalogScope(scope('query', [filter('bedrooms', 3)], 'penthouse'), catalogFactScope({ group: 'residential', filters: { bedrooms_any: [2, 3] } })), true)
  assert.equal(claimWithinCatalogScope(scope('query', [filter('bedrooms', 4)]), catalogFactScope({ group: 'residential', filters: { bedrooms_any: [2, 3] } })), false)
  assert.equal(claimWithinCatalogScope(scope('inventory', [], 'local', 'commercial'), catalogFactScope({ group: 'residential', filters: {} })), false)
  assert.equal(claimWithinCatalogScope(scope('query', [filter('area_internal_m2', 130, 'gte'), filter('area_internal_m2', 160, 'lte')]),
    catalogFactScope({ group: 'residential', requirements: [{ field: 'area_internal_m2', operator: 'between', value: 120, upper_value: 180, strength: 'required' }] })), true)
})

test('the same absence contract covers floors, areas, prices, bathrooms, disjunctions and documented spaces', () => {
  const catalog = [{ id: 'unit', unit_number: '202', category: 'departamento', bedrooms: 2, floor_number: 2,
    area_internal_m2: 120, published_commercial_price: 300000, bathrooms_full: 2, spaces: ['Balcón'], is_published: true, status: 'disponible' }]
  const cases: [Row, Row[]][] = [
    [{ filters: { floor_number: 4 } }, [filter('floor_number', 4)]],
    [{ filters: { min_area_m2: 200 } }, [filter('area_internal_m2', 200, 'gte')]],
    [{ requirements: [{ ...filter('published_commercial_price', 100000, 'lt'), strength: 'required' }] }, [filter('published_commercial_price', 100000, 'lt')]],
    [{ requirements: [{ ...filter('bathrooms_full', 3), strength: 'required' }] }, [filter('bathrooms_full', 3)]],
    [{ filters: { bedrooms_any: [3, 5] } }, [filter('bedrooms', 3)]],
    [{ requirements: [{ field: 'spaces', operator: 'not_contains', value: 'Balcón', upper_value: null, strength: 'required' }] },
      [{ field: 'spaces', operator: 'not_contains', value: 'Balcón', upper_value: null }]],
  ]
  for (const [input, filters] of cases) {
    const query = catalogQuery({ group: 'residential', scope: 'catalog', operation: 'search', ...input })
    const result = completeCatalogResult({ catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true } }, query,
      { purpose: 'search', requirements: [] })
    assert.equal(result.summary.exact_count, true)
    assert.equal(result.summary.matching_count, 0)
    const absence = fact(emptyId, 0, scope('query', filters))
    const check = validateBusinessFacts([absence], catalog, result.groups, {})[0]
    assert.equal(check.status, 'verified', JSON.stringify({ query, check }))
    const validate = new Ajv().compile(businessRiskSchemaForSources([], result.groups))
    assert.equal(validate({ verdict: 'pass', review_contract: BUSINESS_RISK_REVIEW_VERSION, facts: [absence], findings: [], question: null }), true)
    assert.equal(validateBusinessFacts([fact(emptyId, 0, scope('query', []))], catalog, result.groups, {})[0].status, 'unverified')
  }
})

test('incomplete reads, unknown predicates and top-k examples never prove absence or exact inventory counts', () => {
  for (const sample of [context(inventory, false), context([...inventory, { id: 'unknown', category: 'departamento', bedrooms: null }])]) {
    assert.equal(validateBusinessFacts([fact(emptyId)], inventory, sample.evidence.groups, {})[0].status, 'unverified')
    assert.equal(factFindings(validateBusinessFacts([fact(emptyId)], inventory, sample.evidence.groups, {})).length, 1, 'semantic approval cannot certify unknown absence')
    assert.equal(sample.result.summary.exact_count, false)
  }
  const unknownUnits = [{ id: 'unknown', category: 'departamento', bedrooms: null }]
  const completeInventory = turnEvidence({ catalogo: [], catalogo_verificacion: unknownUnits, catalog_read: { complete: true } })
  assert.equal(validateBusinessFacts([fact('group:inventory:residential:range', 0, scope('inventory'))], unknownUnits, completeInventory.groups, {})[0].status, 'unverified')
  const partial = turnEvidence({ catalogo: [], catalogo_verificacion: inventory.slice(0, 1), catalog_read: { complete: true, scope: 'optimized_catalog' } })
  assert.equal(validateBusinessFacts([fact('group:inventory:residential:range', 1, scope('inventory', []), 'catalog_value')], inventory.slice(0, 1), partial.groups, {})[0].status, 'unverified')
  const missingMember = validateBusinessFacts([fact('group:inventory:residential:range', 49, scope('inventory', []), 'catalog_value')], inventory.slice(1), context().evidence.groups, {})[0]
  assert.equal(missingMember.status, 'unverified')
})

test('alternatives keep their own count and cannot satisfy or replace the original request', () => {
  const { verified, audit } = context()
  const proposed = inventory.filter(unit => unit.bedrooms === 3)
  const evidence = turnEvidence({ ...verified, siguiente_paso_comercial: { action: 'clarify_requirements', alternative_unit_ids: proposed.map(u => u.id) } }, audit)
  const alternative = fact('group:requirement_alternatives:departamento:range', 7, scope('alternatives', [filter('bedrooms', 3)], 'departamento'), 'catalog_value')
  assert.equal(validateBusinessFacts([alternative], inventory, evidence.groups, {})[0].status, 'verified')
  assert.equal(validateBusinessFacts([{ ...alternative, subject_id: emptyId }], inventory, evidence.groups, {})[0].status, 'unverified')
  assert.equal(validateBusinessFacts([fact(alternative.subject_id as string, 0, scope('alternatives', [filter('bedrooms', 3)], 'departamento'))], inventory, evidence.groups, {})[0].status, 'contradiction')
})

test('writer and reviewer receive scoped compact aggregates without widening the empty query', () => {
  const { verified, audit, evidence } = context()
  assert.equal(evidence.units.length, 0)
  const model = taskModelEvidence(evidence, { ...verified, prompt_context_selection: { version: 'task-context-v1', task: 'property' }, property_context: { query } })
  assert.equal(model.units.length, 0)
  const global = model.groups.filter(group => group.source_scope === 'catalog_inventory')
  assert.ok(global.length)
  assert.ok(global.every(group => !('member_ids' in group) && group.aggregation === 'range' && group.query_scope))
  assert.equal(global.find(group => group.id === 'group:inventory:residential:range')?.unit_count, 49)
  assert.equal(object(model.groups.find(group => group.id === emptyId)?.query_scope).group, 'residential')
  assert.ok(JSON.stringify(global).length < JSON.stringify(inventory).length)
  const schema = businessRiskSchemaForSources(model.units, model.groups)
  const validate = new Ajv({ allErrors: true }).compile(schema)
  const review = { verdict: 'pass', review_contract: BUSINESS_RISK_REVIEW_VERSION, facts: [fact(emptyId)], findings: [], question: null }
  assert.equal(validate(review), true, JSON.stringify(validate.errors))
  assert.equal(validate({ ...review, facts: [{ ...fact(emptyId), field: 'bedrooms', value: 5 }] }), false)
  assert.equal(validate({ ...review, facts: [{ ...fact(emptyId), kind: 'catalog_value', field: 'bedrooms', value: 5, scope: null }] }), false,
    'an empty query cannot be used as a positive unit attribute source')
  assert.equal(validate({ ...review, facts: [{ ...fact(emptyId), kind: 'catalog_value', scope: null }] }), false)
  assert.equal(audit.source, 'catalog_search')
})

test('a reviewed empty-search answer passes in one draft and retains the alternative acceptance question', async () => {
  const { verified, audit } = context()
  const reply = 'Actualmente no disponemos de viviendas de 5 dormitorios. Podemos revisar las opciones de 3 dormitorios para valorar si se adaptan a su familia. ¿Le gustaría conocer esas alternativas?'
  const question = { purpose: 'clarify_request', role: 'necessary_clarification', missing_datum: 'Aceptación de tres dormitorios', next_decision: 'Explorar alternativas',
    continuation_id: 'property_requirements', continuation_act: 'explore_alternatives' }
  const calls: string[] = []
  const result = await completeTurnReply({ current, baseReply: 'La consulta tiene 0 coincidencias confirmadas.',
    verified: { ...verified, property_context: { query } }, audit }, async (_rules, data, schema, _image, _file, _tone, task) => {
    calls.push(task || '')
    const result: Row = task === 'writing' ? { reply, question, requests: [{ fragment: 'R1', intent: 'Vivienda de cinco dormitorios', request_type: 'specific_fact', status: 'answered', evidence: reply, fact_key: 'bedrooms' }] }
      : { verdict: 'pass', review_contract: BUSINESS_RISK_REVIEW_VERSION, facts: [fact(emptyId)], findings: [], question: { ...question, offered_action: 'information' } }
    assert.equal(new Ajv({ allErrors: true }).compile(schema)(result), true)
    if (task === 'review') assert.equal(object(object(data).fuentes_autorizadas).unidades instanceof Array && (object(object(data).fuentes_autorizadas).unidades as Row[]).length, 0)
    return result
  })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, false)
  assert.equal(object(result.audit.recovery).pending, undefined)
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(object(object(result.audit.semantic_review).question).continuation_id, 'property_requirements')
})

test('a mistaken global source is repaired without rewriting a correct answer or handing off', async () => {
  for (const firstBasis of ['inventory', 'subject']) {
  const { verified, audit } = context()
  const reply = 'No disponemos de viviendas de 5 dormitorios. Actualmente hay 49 viviendas disponibles en el proyecto.'
  const global = fact('group:inventory:residential:range', 49, scope('inventory', []), 'catalog_value')
  global.statement = 'Actualmente hay 49 viviendas disponibles en el proyecto.'
  const calls: string[] = []
  const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
  const result = await completeTurnReply({ current, baseReply: 'La consulta tiene 0 coincidencias confirmadas.', verified: { ...verified, property_context: { query } }, audit },
    async (_rules, _data, schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      const output = task === 'writing' ? { reply, question: noQuestion, requests: [{ fragment: 'R1', intent: 'Vivienda de cinco dormitorios', request_type: 'specific_fact', status: 'answered', evidence: reply, fact_key: 'bedrooms' }] }
        : { verdict: 'pass', review_contract: BUSINESS_RISK_REVIEW_VERSION, findings: [], question: null,
          facts: [fact(emptyId), { ...global, subject_id: calls.length === 2 ? emptyId : global.subject_id,
            scope: { ...object(global.scope), basis: calls.length === 2 ? firstBasis : 'inventory' } }] }
      const validate = new Ajv({ allErrors: true }).compile(schema)
      assert.equal(validate(output), true, JSON.stringify(validate.errors))
      return output
    })
  assert.equal(result.audit.status, 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(calls, firstBasis === 'inventory' ? ['writing', 'review'] : ['writing', 'review', 'review'])
  assert.ok((object(result.audit.semantic_review).fact_checks as Row[]).every(row => row.status === 'verified'))
  if (firstBasis === 'subject') assert.equal((result.audit.repair_attempts as Row[])[0].target, 'review_metadata')
  }
})
