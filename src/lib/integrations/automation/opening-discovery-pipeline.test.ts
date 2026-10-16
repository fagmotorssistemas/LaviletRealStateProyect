import { writerFixture } from './fixtures/writer-response.fixture'
import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { LAVILET_APPROVED_INTRODUCTION, projectIntroductionContext } from '@/lib/inmobiliaria/projectIntroduction'
import { object, text, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { mergeLeadProfile } from './lead-profile'
import { resolvePropertyTurn } from './property-context'
import { resolveTurnIntent } from './turn-intent'
import { leadIntroductionTurn, leadProfilePendingQuestion, rememberLeadIntroduction } from './lead-introduction'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { completeTurnReply, turnCompletenessIssues } from './turn-completeness'
import { withProjectIntroductionForTurn } from './project-introduction-context'
import { withResponseReviewPolicy } from './response-review-policy'
import { BROCHURE_URL } from './project-material'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const catalog: Row[] = [
  { id: 'd201', unit_number: '201', category: 'departamento', bedrooms: 3, floor_number: 2,
    area_internal_m2: 120.83, published_commercial_price: 250000, is_published: true, status: 'disponible' },
  { id: 'l1', unit_number: 'L1', category: 'local', floor_number: 0,
    published_commercial_price: 100000, is_published: true, status: 'disponible' },
]

function extraction(current: string, intent: string, questionId = 'none'): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.catalog_request = { purpose: 'none', metric: null, evidence: '', confidence: 'low', requirements: [], semantic_preferences: [] }
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = intent
  semantics.primary_evidence = current
  semantics.answer_to_previous = { question_id: questionId, kind: questionId === 'none' ? 'none' : 'value',
    evidence: questionId === 'none' ? '' : current, confidence: 'high' }
  return raw
}

function questionMetadata(plan: Row, audit: Row) {
  const profile = object(audit.profile_introduction)
  const purpose = text(profile.question_purpose)
  if (purpose && purpose !== 'none') return {
    role: 'required_collection', purpose: 'collect_lead_profile',
    missing_datum: purpose === 'confirm_residence' ? 'Confirmar residencia actual' : 'Nombre y residencia actual',
    next_decision: 'Entregar el brochure y orientar según lo que busca',
    continuation_id: purpose === 'confirm_residence' ? 'lead_residence_confirmation' : 'lead_profile',
    continuation_act: 'profile',
  }
  return { role: 'necessary_clarification', purpose: 'clarify_request',
    missing_datum: plan.action === 'ask_budget' ? 'Presupuesto total de compra' : 'Vivienda o local comercial',
    next_decision: 'Continuar la búsqueda con los datos pendientes', continuation_id: plan.question_id,
    continuation_act: plan.action === 'ask_budget' ? 'budget' : 'choose_category' }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test('general opening, origin, residence and housing interest keep the discovery order without assuming purpose: '+mode, async () => {
    let summary: Row = {}, lead: Row = {}
    const history: Row[] = []
    const messages = [
      'Saludos, quiero informacion por favor',
      'Soy Carlos y soy de Cuenca',
      'si yo vivo en cuenca',
      'Algo para vivienda',
    ]
    for (const [index, current] of messages.entries()) {
      const pending = object(summary._pending_question)
      const raw = extraction(current, index === 0 ? 'project_information' : 'answer_previous', text(pending.id) || 'none')
      const property = object(object(raw.turn_semantics).property)
      if (index === 0) {
        // The real extractor incorrectly narrowed this general inquiry to housing.
        property.group = 'residential'; property.evidence = current
        raw.requests = [{ domain: 'property', topics: ['project_overview'], request: 'Quiero información del proyecto',
          evidence: current, confidence: 'high' }]
      } else if (index === 1) {
        raw.full_name = 'Carlos'
        raw.profile_evidence = { full_name: 'Soy Carlos', residence_city: null, residence_country: null }
        raw.declared_location = { city: 'Cuenca', country: null, kind: 'origin', evidence: 'soy de Cuenca' }
      } else if (index === 2) {
        // The real output confused residence with the purpose of the purchase.
        raw.purchase_purpose = 'vivir'
        raw.declaration_evidence = { preferred_category: null, purchase_purpose: current }
        raw.events = ['declared_purchase_purpose']
        raw.residence_city = 'Cuenca'
        raw.profile_evidence = { full_name: null, residence_city: current, residence_country: null }
        property.group = 'residential'; property.evidence = current
        object(object(raw.turn_semantics).answer_to_previous).kind = 'affirmative'
      } else {
        raw.purchase_purpose = 'vivir'
        raw.declaration_evidence = { preferred_category: null, purchase_purpose: current }
        raw.events = ['declared_purchase_purpose']
        property.group = 'residential'; property.operation = 'search'; property.evidence = current
      }
      let extractionCalls = 0
      const interpretation = await interpretConversationTurn({ mensaje_actual: current, historial: history,
        resumen: summary, pregunta_pendiente: pending, perfil_inicial: summary._lead_profile }, {
        activePrompt: async () => '', aiJson: async () => { extractionCalls++; return raw },
      })
      assert.equal(extractionCalls, 1, current+' must not require an extra model call for a demonstrated contradiction')
      if (index === 0 || index === 2) {
        assert.equal(interpretation.extracted.purchase_purpose, null)
        assert.notEqual(object(interpretation.semantics.property).group, 'residential')
        assert.ok(!(interpretation.extracted.events as string[]).includes('declared_purchase_purpose'))
      }
      const previous = summary
      summary = rememberInterpretedTurn(previous, current, interpretation.extracted, interpretation.semantics)
      summary._lead_profile = mergeLeadProfile(previous._lead_profile, interpretation.extracted.lead_profile)
      if (interpretation.extracted.purchase_purpose) lead = { ...lead, purchase_purpose: interpretation.extracted.purchase_purpose }
      const resolved = resolvePropertyTurn(catalog, current, summary, history, interpretation.semantics)
      summary._property_context = resolved.context
      const intent = resolveTurnIntent({ current, semantics: interpretation.semantics, requests: interpretation.requests,
        pendingQuestion: pending, scope: { kind: 'property', uncertain: false },
        profilePending: object(previous._lead_introduction).status === 'pending' })
      const info: Row = { lead, perfil_lead: summary._lead_profile, catalogo: catalog, catalogo_verificacion: catalog,
        catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
        semantica_turno: interpretation.semantics, solicitudes_interpretadas: interpretation.requests, contrato_turno: intent,
        property_context: resolved.context, hechos_confirmados: confirmedInterpretationMemory(summary),
        proyecto: { name: 'La Vilet' }, configuracion_presentacion_proyecto: projectIntroductionContext({}, 'La Vilet'),
        estado_conversacion: { brochure_sent: object(previous._lead_introduction).brochure_sent === true },
        financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} } }
      const intro = leadIntroductionTurn({ current, history, summary: { ...previous, _lead_profile: summary._lead_profile },
        extracted: interpretation.extracted, reply: '¿Busca una vivienda o un local comercial?', projectInfo: info,
        catalog, audit: { source: 'commercial', resolved_turn_intent: intent, semantic_review_enabled: true,
          business_risk_review_enabled: true } })
      const next = commercialJourneyPlan(info, intro.audit)
      info.siguiente_paso_comercial = next
      const audit: Row = { ...intro.audit, commercial_journey: next }
      assert.equal(next.action, index < 2 ? 'introduction' : index === 2 ? 'discover_use' : 'ask_budget', current)
      const reply = index < 2 ? intro.reply : index === 2
        ? 'Gracias por confirmar que reside en Cuenca. Aquí tiene el brochure digital del proyecto: '+BROCHURE_URL+' '+next.question
        : 'Con gusto le orientamos con las opciones de vivienda. '+next.question
      const metadata = questionMetadata(next, audit)
      const contexts: Row[] = [], tasks: string[] = []
      const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
        () => completeTurnReply({ current, baseReply: intro.reply, verified: info, history, audit },
          async (_rules, input, _schema, _image, _file, _tone, task) => {
            const context = object(input); contexts.push(context); tasks.push(task || '')
            if (task === 'writing') return writerFixture({ reply, question: metadata,
              writer_receipts: { project_presented: index === 0, brochure_shared: index === 2 },
              requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Atender la consulta',
                request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) })
            return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
          }))
      assert.ok(result.reply.endsWith(reply), JSON.stringify(result.audit.final_validation))
      assert.equal(result.needsAdvisor, false)
      assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
      const writer = contexts[0]
      if (index === 0) {
        assert.ok(reply.includes(LAVILET_APPROVED_INTRODUCTION.summary))
        assert.equal(object(object(writer.contexto_verificado).presentacion_general_proyecto).summary, LAVILET_APPROVED_INTRODUCTION.summary)
        const stage = object(object(writer.contrato_redaccion).estado_comercial)
        assert.equal(stage.presentacion_sin_tipos, false)
        assert.equal(object(stage.presentacion_proyecto).required, true)
        assert.ok(rows(writer.obligaciones_del_turno).some(obligation => obligation.id === 'opening_presentation'))
        assert.ok(!(object(result.audit.final_validation).issues as string[]).includes('numbers_changed'))
        assert.ok(!reply.includes(BROCHURE_URL))
      } else {
        assert.equal(object(writer.contexto_verificado).presentacion_general_proyecto, undefined, 'Do not repeat the opening during profile/discovery')
        assert.ok(!reply.includes(LAVILET_APPROVED_INTRODUCTION.summary))
      }
      if (index === 1) {
        assert.match(reply, /residencia actual/)
        assert.ok(!reply.includes(BROCHURE_URL))
      }
      if (index === 2) {
        assert.equal(object(summary._lead_profile).residence_city, 'Cuenca')
        assert.equal(lead.purchase_purpose, undefined)
        assert.equal(text(object(confirmedInterpretationMemory(summary).qualification).proposito), '')
        assert.match(reply, /vivienda.*local/)
        assert.doesNotMatch(reply, /presupuesto|dormitorios/)
        assert.equal(object(object(object(writer.response_content_scope).topics).purchase_prices).allowed, false)
      }
      if (index === 3) {
        assert.equal(lead.purchase_purpose, undefined, 'A housing interest can be personal use or investment')
        assert.equal(interpretation.extracted.purchase_purpose, null)
        assert.equal(object(interpretation.semantics.property).group, 'residential')
        assert.equal(resolved.query.group, 'residential')
        assert.equal(text(object(confirmedInterpretationMemory(summary).qualification).proposito), '')
        assert.match(reply, /presupuesto.*compra/)
        assert.doesNotMatch(reply, /dormitorios|planta|250000|100000/)
      }
      const deliveredReply = result.reply
      const receiptAudit = { ...audit, turn_completeness: result.audit }
      summary._lead_introduction = rememberLeadIntroduction({ previous: previous._lead_introduction,
        planned: intro.state, profile: summary._lead_profile, reply: deliveredReply, audit: receiptAudit, accepted: true, followUpUsable: true })
      const profilePending = leadProfilePendingQuestion(deliveredReply, receiptAudit)
      summary._pending_question = text(profilePending.id) ? profilePending
        : journeyPendingQuestion(deliveredReply, next, true, result.audit.question)
      assert.equal(object(summary._pending_question).id, metadata.continuation_id)
      if (index === 0) assert.equal(object(summary._lead_introduction).presentation_sent, true)
      history.push({ role: 'user', content: current }, { role: 'bot', content: deliveredReply })
    }
  })
}

test('only the selected approved introduction supplies numeric evidence, without trusting historical summaries', () => {
  const current = 'Saludos, quiero información por favor'
  // A configured numeric presentation still needs provenance even though the
  // default presentation intentionally does not enumerate units or dimensions.
  const summary = 'La Vilet cuenta con 49 unidades de vivienda.'
  const requests = [{ domain: 'property', topics: ['project_overview'], request: 'Información general', evidence: current, confidence: 'high' }]
  const semantics = object(extraction(current, 'project_information').turn_semantics)
  const info: Row = { proyecto: { name: 'La Vilet' }, semantica_turno: semantics,
    solicitudes_interpretadas: requests,
    contrato_turno: resolveTurnIntent({ current, semantics, requests, scope: { kind: 'property', uncertain: false } }),
    configuracion_presentacion_proyecto: projectIntroductionContext({ project_introduction: { current: {
      enabled: true, summary, source: 'Resumen autorizado de prueba' } } }, 'La Vilet') }
  const selected = withProjectIntroductionForTurn(info)
  const input = { current, baseReply: summary, verified: selected, audit: {} }
  assert.equal(object(selected.presentacion_general_proyecto).summary, summary)
  assert.equal(object(selected.presentacion_general_proyecto).source, 'Resumen autorizado de prueba')
  assert.equal(withProjectIntroductionForTurn({ summary, proyecto: { name: 'La Vilet' } }).presentacion_general_proyecto, undefined,
    'a historical summary is never promoted to approved factual evidence')
  assert.equal(info.presentacion_general_proyecto, undefined, 'selection does not mutate the raw configured context')
  assert.ok(!turnCompletenessIssues(input, input.baseReply).includes('numbers_changed'))
  assert.deepEqual(turnCompletenessIssues(input, input.baseReply.replace('49 unidades', '50 unidades')), [],
    'the code must not issue a numeric verdict from the wording; the AI reviewer owns that check')
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test('combined name and residence delivers the brochure and asks for the asset before budget: '+mode, async () => {
    const current = 'Claro, soy carlos y vivo en cuenca'
    const pending = { id: 'lead_profile', act: 'profile', question: '¿Cómo se llama y en qué ciudad reside actualmente?' }
    const previous: Row = { _pending_question: pending, _lead_introduction: { status: 'pending', presentation_sent: true } }
    const history = [{ role: 'user', content: 'Saludos, quiero información' }, { role: 'bot', content: pending.question }]
    const raw = extraction(current, 'answer_previous', pending.id)
    raw.full_name = 'carlos'; raw.residence_city = 'cuenca'
    raw.profile_evidence = { full_name: current, residence_city: 'vivo en cuenca', residence_country: null }
    raw.purchase_purpose = 'vivir'; raw.declaration_evidence = { preferred_category: null, purchase_purpose: current }
    raw.events = ['declared_purchase_purpose']
    Object.assign(object(object(raw.turn_semantics).property), { group: 'residential', operation: 'none', evidence: current })
    let extractionCalls = 0
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, historial: history,
      resumen: previous, pregunta_pendiente: pending }, {
      activePrompt: async () => '', aiJson: async () => { extractionCalls++; return raw },
    })
    assert.equal(extractionCalls, 1)
    assert.equal(interpreted.extracted.purchase_purpose, null)
    assert.equal(object(interpreted.semantics.property).group, null)
    const summary = rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics)
    summary._lead_profile = mergeLeadProfile(previous._lead_profile, interpreted.extracted.lead_profile)
    const resolved = resolvePropertyTurn(catalog, current, summary, history, interpreted.semantics)
    summary._property_context = resolved.context
    const intent = resolveTurnIntent({ current, semantics: interpreted.semantics, requests: interpreted.requests,
      pendingQuestion: pending, scope: { kind: 'property', uncertain: false }, profilePending: true })
    const info: Row = { lead: {}, perfil_lead: summary._lead_profile, catalogo: catalog, catalogo_verificacion: catalog,
      catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
      semantica_turno: interpreted.semantics, solicitudes_interpretadas: interpreted.requests, contrato_turno: intent,
      property_context: resolved.context, hechos_confirmados: confirmedInterpretationMemory(summary),
      proyecto: { name: 'La Vilet' }, configuracion_presentacion_proyecto: projectIntroductionContext({}, 'La Vilet'),
      estado_conversacion: { brochure_sent: false }, financiamiento: { partners: [], journey: {} } }
    const intro = leadIntroductionTurn({ current, history, summary: { ...previous, _lead_profile: summary._lead_profile },
      extracted: interpreted.extracted, reply: '¿Le interesa una vivienda o un local comercial?', projectInfo: info,
      catalog, audit: { source: 'commercial', resolved_turn_intent: intent,
        semantic_review_enabled: true, business_risk_review_enabled: true } })
    const next = commercialJourneyPlan(info, intro.audit)
    info.siguiente_paso_comercial = next
    assert.equal(next.action, 'discover_use')
    const audit = { ...intro.audit, commercial_journey: next }
    const reply = 'Mucho gusto, Carlos. Aquí tiene el brochure digital: '+BROCHURE_URL+' '+next.question
    const metadata = questionMetadata(next, audit), tasks: string[] = []
    const completed = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current, baseReply: intro.reply, verified: info, history, audit },
        async (_rules, input, _schema, _image, _file, _tone, task) => {
          tasks.push(task || '')
          if (task === 'writing') return writerFixture({ reply, question: metadata,
            requests: rows(object(input).referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Atender datos de perfil',
              request_type: 'clarification', status: 'answered', evidence: reply, fact_key: null })) })
          return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
        }))
    assert.equal(completed.needsAdvisor, false)
    assert.match(completed.reply, /vivienda.*local comercial/, JSON.stringify(completed.audit.final_validation))
    assert.doesNotMatch(completed.reply, /presupuesto|dormitorios/)
    assert.ok(completed.reply.includes(BROCHURE_URL))
    assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    const receipt = journeyPendingQuestion(completed.reply, next, true, completed.audit.question)
    assert.equal(receipt.id, 'property_category')
  })
}
