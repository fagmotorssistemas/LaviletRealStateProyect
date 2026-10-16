import { writerFixture } from './fixtures/writer-response.fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import { BROCHURE_DESCRIPTION, BROCHURE_URL } from './project-material'
import { verifiedClaimSources } from './turn-evidence'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'

test('approved brochure description is a shared fact and does not claim measured rooms or model access to drawings', () => {
  const sources = verifiedClaimSources({ brochure_url: BROCHURE_URL }, {}, { units: [], groups: [] })
  const source = object(sources.find(row => row.path === 'materiales_configurados.brochure'))
  assert.equal(source.kind, 'project_fact')
  assert.equal(object(source.value).contains_floor_plans, true)
  assert.equal(object(source.value).room_dimensions_verified, false)
  assert.equal(object(source.value).model_has_examined_plans, false)
})

test('the writer and factual reviewer both receive the approved floor-plan description', async () => {
  const tasks: string[] = []
  const result = await completeTurnReply({ current: '¿El brochure contiene planos?', baseReply: 'Sí, el brochure contiene planos del proyecto.',
    verified: { brochure_url: BROCHURE_URL, catalogo: [] },
    audit: { source: 'project_information', semantic_review_enabled: true, business_risk_review_enabled: true },
  }, async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); tasks.push(task!)
    if (task === 'writing') {
      assert.deepEqual(object(input.material_protegido).brochure_description, BROCHURE_DESCRIPTION)
      return writerFixture({ reply: 'Sí, el brochure contiene planos del proyecto.',
        question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
        requests: [{ fragment: 'R1', intent: 'Contenido del brochure', request_type: 'general_information', status: 'answered', evidence: 'Descripción aprobada del brochure', fact_key: null }] })
    }
    const facts = object(input.fuentes_autorizadas).otros_hechos_y_politicas as Row[]
    const source = facts.find(row => row.path === 'materiales_configurados.brochure')!
    assert.equal(object(source.value).contains_floor_plans, true)
    assert.equal(object(source.value).room_dimensions_verified, false)
    return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
  })
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(result.needsAdvisor, false)
})
