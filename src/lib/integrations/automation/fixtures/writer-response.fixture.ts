import { object, text, type Row } from '../data'

/** Complete the technical envelope of a deterministic model stub. This is test
 * data construction only, never a production parser or validation authority.
 * IDs/purposes are always supplied by the scenario; no meaning is inferred.
 * Receipt flags default false and must be declared by material/memory tests. */
export function writerFixture(response: Row): Row {
  const reply = text(response.reply), metadata = object(response.question)
  const fixtureQuestions = reply.match(/¿[^¿?]*\?/g) || []
  const question = response.question === null ? null : {
    purpose: 'none', role: 'none', missing_datum: '', next_decision: '',
    continuation_id: 'none', continuation_act: 'other',
    text: metadata.continuation_id && metadata.continuation_id !== 'none' ? fixtureQuestions.at(-1) || '' : '',
    comparison_categories: [], comparison_bedrooms: null,
    ...metadata,
  }
  return { ...response, question, writer_receipts: {
    presented_unit_ids: [], project_presented: false, financing_mentioned: false,
    visit_invited: false, unit_options_offered: false, unit_model_shared: false,
    mentioned_benefits: [], brochure_shared: false, price_notice_included: false,
    brand_introduced: false, offered_action: 'none', ...object(response.writer_receipts),
  } }
}

/** A pure planning test declares that the planned question was emitted. Tests
 * exercising the actual writer must use result.audit.question instead. */
export function plannedQuestionFixture(plan: Row): Row {
  const id = text(plan.question_id), act = text(plan.question_act)
  const purpose = id === 'financing_partner' ? 'choose_financing_partner'
    : ['financing_down_payment', 'financing_data'].includes(id) ? 'collect_financing_required'
      : ['financing_invitation', 'reservation_invitation'].includes(id) ? 'permission_to_continue'
        : id.startsWith('lead_') ? 'collect_lead_profile'
          : id.startsWith('visit_') ? 'coordinate_visit' : 'choose_property'
  return { text: text(plan.question), continuation_id: id, continuation_act: act, purpose,
    role: 'optional_continuation', missing_datum: '', next_decision: '',
    comparison_categories: [], comparison_bedrooms: null }
}
