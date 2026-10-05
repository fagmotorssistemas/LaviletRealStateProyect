'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { parseLeadSummary } from '@/lib/inmobiliaria/leadProfileCard'
import { validateFinancingReview, type FinancingReviewInput } from '@/lib/inmobiliaria/financingReviewResult'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'

export async function saveFinancingReview(leadId: string, unitId: string, expectedUpdatedAt: string, input: FinancingReviewInput) {
  await assertAdmin()
  const { supabase, user } = await getSessionUser()
  if (!user) throw Error('Inicie sesión para registrar una revisión.')
  const lead = await supabase.from('leads').select('id,tenant_id,project_id,unit_id,behavior_signals,updated_at')
    .eq('id', leadId).eq('project_id', LAVILET_PROJECT_ID).single()
  if (lead.error || !lead.data) throw Error('No se pudo acceder al lead.')
  if (!expectedUpdatedAt || expectedUpdatedAt !== lead.data.updated_at) throw Error('La ficha cambió. Ábrala de nuevo antes de guardar.')
  const scope = { tenant_id: lead.data.tenant_id, project_id: lead.data.project_id }
  const [unit, conversation, qualification] = await Promise.all([
    supabase.from('units').select('id,published_commercial_price,status,is_published').match(scope).eq('id', unitId).single(),
    supabase.from('conversations').select('summary').match(scope).eq('lead_id', leadId).order('started_at', { ascending: false }).limit(1),
    supabase.from('financing_prequalifications').select('explicit_consent,status,updated_at').match(scope).eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1),
  ])
  if (unit.error || conversation.error || qualification.error || !unit.data) throw Error('No se pudo comprobar la unidad y la revisión.')
  const summary = parseLeadSummary(conversation.data?.[0]?.summary)
  const property = parseLeadSummary(summary._property_context)
  const selected = Array.isArray(property.selected_ids) ? property.selected_ids : [lead.data.unit_id]
  if (selected.length !== 1 || selected[0] !== unitId || unit.data.status !== 'disponible' || unit.data.is_published === false)
    throw Error('La unidad seleccionada cambió o ya no está disponible.')
  if (input.result === 'favorable' && (qualification.data?.[0]?.explicit_consent !== true || qualification.data?.[0]?.status !== 'lista'))
    throw Error('Complete primero el expediente consentido para registrar un resultado favorable.')
  validateFinancingReview(input, Number(unit.data.published_commercial_price))
  const previous = parseLeadSummary(lead.data.behavior_signals)
  const result = { result: input.result, unit_id: unitId, unit_price: Number(unit.data.published_commercial_price),
    qualification_updated_at: qualification.data?.[0]?.updated_at || null,
    own_funds: input.ownFunds, financing_amount: input.financingAmount, note: input.note.trim(), reviewed_by: user.id, reviewed_at: new Date().toISOString() }
  const history = Array.isArray(previous.financing_review_history) ? previous.financing_review_history : []
  const saved = await supabase.from('leads').update({ behavior_signals: { ...previous, financing_review: result,
    financing_review_history: [...history, result].slice(-30) } }).match(scope).eq('id', leadId).eq('updated_at', expectedUpdatedAt).select('updated_at').maybeSingle()
  if (saved.error || !saved.data) throw Error('La ficha cambió o no se pudo guardar. Vuelva a abrirla.')
  return { review: result, updatedAt: saved.data.updated_at as string }
}
