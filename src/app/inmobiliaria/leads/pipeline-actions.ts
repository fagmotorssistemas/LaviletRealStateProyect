'use server'

import { assertCanAccessCrmPath, assertCanWriteCrm, getSessionUser } from '@/lib/auth/session'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { projectLeadPipeline } from '@/lib/inmobiliaria/leadPipeline'
import { leadProfileCard, parseLeadSummary } from '@/lib/inmobiliaria/leadProfileCard'
import { loadLeadPipelineSources, readPipelineRelated, type PipelineSourceRow as Row } from '@/services/leadPipelineSources.service'
import { LEAD_PIPELINE_STAGE_OPTIONS } from '@/types/leadPipeline'
import { UNASSIGNED_ASSIGNEE, type Lead } from '@/types/inmobiliaria'
import type { ListLeadPipelineInput, ListLeadPipelineResult, LeadPipelineCard } from '@/hooks/inmobiliaria/useLeadPipeline'
import type { LeadPipelineDetailResult, LeadPipelineMetadataInput, LeadPipelineMetadataResult } from '@/types/leadPipelineDetail'

const str = (value: unknown) => typeof value === 'string' ? value : ''
const obj = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const uid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const bounded = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, max) : fallback
type Sources = Awaited<ReturnType<typeof loadLeadPipelineSources>>

function ownSources(sources: Sources, lead: Row, jobs: Row[] = []) {
  const own = (values: Row[]) => values.filter(value => value.lead_id === lead.id)
  const conversations = own(sources.conversations).sort((a, b) => str(b.started_at || b.last_message_at).localeCompare(str(a.started_at || a.last_message_at)))
  const conversationIds = new Set(conversations.map(row => row.id))
  return { lead, conversation: conversations[0] || null,
    messages: sources.messages.filter(row => conversationIds.has(row.conversation_id) || !row.conversation_id && row.lead_id === lead.id), scoreEvents: own(sources.events),
    appointments: own(sources.appointments), reservations: own(sources.reservations), sales: own(sources.sales),
    metadata: own(sources.metadata)[0] || null, units: sources.units.filter(unit => unit.project_id === lead.project_id),
    history: own(sources.history),
    jobs: jobs.filter(row => row.lead_id === lead.id), coverage: sources.coverage, warnings: sources.warnings }
}

async function readJobs(sources: Sources, userId: string, role: string | null): Promise<Row[]> {
  const admin = tryCreateAdminClient()
  const allowed = sources.leads.filter(lead => role === 'admin' || role === 'asesor' && lead.assigned_to === userId).map(lead => str(lead.id))
  if (!admin || !allowed.length) return []
  try {
    const rows = await readPipelineRelated(allowed, (ids, from, to) => admin.from('lv_integration_events')
      .select('id,lead_id:payload->>leadId,task:payload->>task,status,available_at,received_at,completed_at')
      .eq('kind', 'maintenance').in('payload->>leadId', ids)
      .in('payload->>task', ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three'])
      .order('id').range(from, to))
    return rows.map(row => ({ ...row, kind: 'maintenance', payload: { leadId: row.lead_id, task: row.task } }))
  } catch { sources.warnings.push('No se pudieron consultar los seguimientos programados.'); return [] }
}

async function recordStageObservations(sources: Sources, cards: { leadId: string; pipeline: ReturnType<typeof projectLeadPipeline> }[]) {
  if (Object.values(sources.coverage).some(ok => !ok)) return
  const admin = tryCreateAdminClient()
  if (!admin) return
  // This records when the application observes a changed classification. The
  // original fact date remains separate; no historical transition is invented.
  for (let from = 0; from < cards.length; from += 200) {
    const observations = cards.slice(from, from + 200).map(({ leadId, pipeline }) => ({ lead_id: leadId,
      stage: pipeline.stage, reason: pipeline.stageReason, evidence: pipeline.evidence, source_at: pipeline.evidence[0]?.at || pipeline.stageChangedAt }))
    const { error } = await admin.rpc('record_lead_commercial_stage_observations', { p_observations: observations })
    if (error) { sources.warnings.push('No se pudo registrar la observación de etapas. Compruebe la migración del embudo.'); return }
  }
}

function publicLead(row: Row, sources: Sources): Lead {
  const profile = sources.profiles.find(value => value.id === row.assigned_to)
  return { id: str(row.id), tenant_id: str(row.tenant_id), name: str(row.name), phone: str(row.phone) || null,
    kommo_id: typeof row.kommo_id === 'number' ? row.kommo_id : null,
    preferred_category: str(row.preferred_category) || null, purchase_purpose: str(row.purchase_purpose) || null,
    status: row.status as Lead['status'], temperature: row.temperature as Lead['temperature'],
    temperature_score: Number(row.temperature_score) || 0, temperature_updated_at: str(row.temperature_updated_at) || null,
    budget: typeof row.budget === 'number' ? row.budget : null, financing: row.financing === true,
    assigned_to: str(row.assigned_to) || null, source: str(row.source) || null,
    last_activity_at: str(row.last_activity_at) || null, last_activity_source: row.last_activity_source as Lead['last_activity_source'],
    resume: null, created_at: str(row.created_at), updated_at: str(row.updated_at),
    assigned_profile: profile ? { full_name: str(profile.full_name) || null, avatar_url: str(profile.avatar_url) || null } : undefined }
}

export async function listLeadPipelineAction(input: ListLeadPipelineInput = {}): Promise<ListLeadPipelineResult> {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/leads')
    const { supabase } = await getSessionUser()
    const sources = await loadLeadPipelineSources(supabase)
    const jobs = await readJobs(sources, session.user.id, session.profile.role)
    const search = str(input.search).trim().toLocaleLowerCase().slice(0, 160)
    const dateBoundary = (value: unknown, end: boolean) => /^\d{4}-\d{2}-\d{2}$/.test(str(value))
      ? Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}-05:00`) : null
    const from = dateBoundary(input.dateFrom, false), to = dateBoundary(input.dateTo, true)
    let cards: LeadPipelineCard[] = sources.leads.map(lead => ({ lead: publicLead(lead, sources), pipeline: projectLeadPipeline(ownSources(sources, lead, jobs)) }))
    await recordStageObservations(sources, cards.map(card => ({ leadId: card.lead.id, pipeline: card.pipeline })))
    cards = cards.filter(({ lead, pipeline }) => {
      if (search && ![lead.name, lead.phone, lead.kommo_id?.toString()].some(value => value?.toLocaleLowerCase().includes(search))) return false
      if (input.stage && pipeline.stage !== input.stage) return false
      if (input.nutrition === 'active' && !pipeline.nutritionActive || input.nutrition === 'inactive' && pipeline.nutritionActive) return false
      if (input.outcome && input.outcome !== 'all' && pipeline.opportunityStatus !== input.outcome) return false
      if (input.assignedTo === UNASSIGNED_ASSIGNEE ? !!lead.assigned_to : input.assignedTo && lead.assigned_to !== input.assignedTo) return false
      if (input.temperature && lead.temperature !== input.temperature) return false
      if (from !== null && Date.parse(lead.created_at) < from || to !== null && Date.parse(lead.created_at) > to) return false
      const status = pipeline.appointment?.status || ''
      if (input.appointment === 'pending' && !['solicitada', 'pendiente', 'aceptado', 'reprogramado', 'requested', 'collecting', 'awaiting_advisor', 'awaiting_client'].includes(status)) return false
      if (input.appointment === 'confirmed' && !['confirmada', 'confirmed'].includes(status)) return false
      if (input.appointment === 'completed' && !['atendido', 'completed'].includes(status)) return false
      if (input.appointment === 'cancelled' && !['cancelado', 'cancelled'].includes(status)) return false
      return true
    }).sort((a, b) => str(input.sort === 'creado' ? b.lead.created_at : b.pipeline.lastActivityAt || b.lead.created_at)
      .localeCompare(str(input.sort === 'creado' ? a.lead.created_at : a.pipeline.lastActivityAt || a.lead.created_at)) || a.lead.id.localeCompare(b.lead.id))
    const pageSize = bounded(input.pageSize, input.view === 'list' ? 25 : 12, 100)
    const paginate = (rows: LeadPipelineCard[], requested: unknown) => {
      const page = Math.min(bounded(requested, 1, 1_000_000), Math.max(1, Math.ceil(rows.length / pageSize)))
      return { page, leads: rows.slice((page - 1) * pageSize, page * pageSize) }
    }
    const list = paginate(cards, input.page)
    return { ok: true, data: { total: cards.length, items: list.leads, page: list.page, pageSize,
      columns: LEAD_PIPELINE_STAGE_OPTIONS.map(({ value: stage }) => {
        const rows = cards.filter(card => card.pipeline.stage === stage), slice = paginate(rows, input.pages?.[stage])
        return { stage, total: rows.length, page: slice.page, pageSize, leads: slice.leads }
      }), warnings: [...new Set(sources.warnings)] } }
  } catch { return { ok: false, error: 'No se pudo cargar el embudo. Compruebe su sesión y acceso a Leads.' } }
}

export async function getLeadPipelineDetailAction(leadId: string): Promise<LeadPipelineDetailResult> {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/leads')
    if (!uid(leadId)) throw new Error('Contacto inválido')
    const { supabase } = await getSessionUser()
    const sources = await loadLeadPipelineSources(supabase, [leadId])
    const lead = sources.leads[0]
    if (!lead) throw new Error('Contacto fuera de alcance')
    const jobs = await readJobs(sources, session.user.id, session.profile.role)
    const own = ownSources(sources, lead, jobs), pipeline = projectLeadPipeline(own), summary = parseLeadSummary(own.conversation?.summary)
    await recordStageObservations(sources, [{ leadId, pipeline }])
    const finance = await supabase.from('financing_prequalifications').select('explicit_consent,selected_partner_name,status')
      .eq('lead_id', leadId).eq('tenant_id', lead.tenant_id).order('created_at', { ascending: false }).limit(1)
    const financeRow = obj(finance.data?.[0])
    const accepted = obj(summary._financing_journey).status !== 'declined'
      && (financeRow.explicit_consent === true || obj(summary._financing_journey).accepted === true)
    const financialAccess = accepted && canAccessPath(session.profile.role, '/inmobiliaria/financiamiento', session.profile.crm_paths)
    if (financialAccess) {
      const identity = await supabase.from('financing_prequalifications')
        .select('legal_name,legal_name_confirmed,national_id,applicant_type,employment_stability_months,job_title,monthly_income')
        .eq('lead_id', leadId).eq('tenant_id', lead.tenant_id).eq('explicit_consent', true).order('created_at', { ascending: false }).limit(1)
      if (!identity.error) Object.assign(financeRow, identity.data?.[0] || {})
      else sources.warnings.push('No se pudo consultar el detalle financiero autorizado.')
    }
    const card = leadProfileCard(lead, summary, financeRow, own.units)
    // General Leads access never expands to legal identity or household income.
    const sensitive = /legal|cédula|situación laboral|cargo|antigüedad|ingreso mensual|aporte revisado|financiamiento revisado/i
    const groups = card.groups.map(group => ({ ...group, fields: group.fields.filter(field => financialAccess || !sensitive.test(field.label)) }))
    const known = (value: unknown) => str(value) || 'Sin confirmar'
    const interaction = obj(summary._interaction_mode)
    const pending = Array.isArray(summary._pending_requests) ? summary._pending_requests.map(obj) : []
    groups.unshift({ title: 'Origen y atención actual', fields: [
      { label: 'Proyecto', value: known(sources.projects.find(row => row.id === lead.project_id)?.name) },
      { label: 'Origen', value: known(lead.source) }, { label: 'Campaña', value: known(lead.campaign) },
      { label: 'Responsable', value: known(sources.profiles.find(row => row.id === lead.assigned_to)?.full_name) },
      { label: 'Modalidad de atención', value: interaction.mode === 'information_only' ? 'Información del proyecto y consultas actuales' : 'Orientación según las solicitudes actuales' },
      { label: 'Consultas pendientes', value: pending.map(row => str(row.content || row.request)).filter(Boolean).join('; ') || 'Sin consultas pendientes registradas' },
    ] })
    if (finance.error) sources.warnings.push('No se pudo consultar la revisión financiera.')
    const metadata = obj(own.metadata), autoNurture = obj(summary._lead_nurture)
    const historyRead = await supabase.from('lead_commercial_profile_history').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(100)
    const history = (historyRead.data || []).map(row => ({ id: str(row.id), at: str(row.created_at), actor: str(row.actor_id) || null,
      reason: str(row.reason), fromStage: str(obj(row.old_data).stage) || null, toStage: str(obj(row.new_data).stage) || null }))
    if (historyRead.error) sources.warnings.push('El historial de la ficha comercial no está disponible.')
    for (const [index, event] of pipeline.history.entries()) history.push({ id: `stage-${index}`, at: event.at || '', actor: event.actor,
      reason: event.reason, fromStage: event.from, toStage: event.to })
    return { ok: true, data: { pipeline, groups,
      appointments: own.appointments.map(row => {
        const view = projectLeadPipeline({ ...own, appointments: [row] }).appointment
        return { id: str(row.id), status: view?.status || str(row.status), label: view?.label || 'Estado por revisar',
          scheduledAt: view?.scheduledAt || null, advisor: str(obj(Array.isArray(row.responsible) ? row.responsible[0] : row.responsible).full_name) || null,
          location: str(row.meeting_place) || null }
      }),
      reservations: own.reservations.map(row => ({ id: str(row.id), status: str(row.request_status) || 'requested',
        unitNumber: own.units.filter(unit => unit.id === row.unit_id || Array.isArray(row.unit_ids) && row.unit_ids.includes(unit.id)).map(unit => str(unit.unit_number)).join(', ') || null,
        requestedAt: str(row.created_at) || null })),
      financing: { accepted, partner: str(financeRow.selected_partner_name) || null, status: str(financeRow.status) || null },
      jobs: jobs.map(row => ({ id: str(row.id), task: str(row.task), status: str(row.status), scheduledAt: str(row.available_at) || null })),
      metadataAvailable: sources.coverage.metadata === true, history,
      metadata: { leadId, nutritionActive: pipeline.nutritionActive, nutritionReason: pipeline.nutritionReason || '',
        purchaseHorizon: pipeline.purchaseHorizon || '', nutritionEvidence: str(metadata.nutrition_evidence || autoNurture.evidence),
        contactConsent: metadata.contact_consent === true || !Object.keys(metadata).length && autoNurture.contact_consent === true,
        resumeAt: pipeline.resumeAt, nextAction: str(metadata.next_action), nextActionAt: str(metadata.next_action_at) || null,
        opportunityStatus: pipeline.opportunityStatus === 'lost' ? 'lost' : 'open', closureReason: pipeline.closureReason || '' },
      warnings: [...new Set(sources.warnings)] } }
  } catch { return { ok: false, error: 'No se pudo cargar la ficha comercial. Compruebe su acceso al contacto.' } }
}

/** Monitoring and Leads share one projection. Read with the caller's RLS and
 * return the commercial snapshot only, never conversation summaries or PII. */
export async function readLeadPipelineSnapshotsAction(leadIds: string[]) {
  try {
    try { await assertCanAccessCrmPath('/inmobiliaria/automatizacion') }
    catch { await assertCanAccessCrmPath('/inmobiliaria/leads') }
    if (!Array.isArray(leadIds) || leadIds.length > 200 || leadIds.some(id => typeof id !== 'string' || !uid(id)))
      throw new Error('Contactos inválidos')
    const { supabase } = await getSessionUser()
    const sources = await loadLeadPipelineSources(supabase, leadIds)
    const data = sources.leads.map(lead => ({ leadId: str(lead.id), pipeline: projectLeadPipeline(ownSources(sources, lead)) }))
    await recordStageObservations(sources, data)
    return { ok: true as const, data }
  } catch { return { ok: false as const, error: 'No se pudo consultar la etapa comercial.' } }
}

export async function updateLeadPipelineMetadataAction(input: LeadPipelineMetadataInput): Promise<LeadPipelineMetadataResult> {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/leads')
    await assertCanWriteCrm()
    if (!uid(str(input.leadId))) throw new Error('Contacto inválido')
    if (typeof input.nutritionActive !== 'boolean' || typeof input.contactConsent !== 'boolean'
      || !['open', 'lost'].includes(input.opportunityStatus)) throw new Error('Datos de ficha inválidos')
    const trim = (value: unknown) => str(value).trim().slice(0, 2000)
    if (input.nutritionActive && (!trim(input.nutritionReason) || !trim(input.purchaseHorizon) || !trim(input.nutritionEvidence) || !input.contactConsent))
      throw new Error('Para activar nutrición registre el motivo, plazo o condición futura y la declaración con el acuerdo de contacto.')
    if (input.opportunityStatus === 'lost' && !trim(input.closureReason)) throw new Error('Indique el motivo de cierre sin venta.')
    if (input.nextActionAt && !trim(input.nextAction)) throw new Error('Describa la próxima acción antes de asignarle una fecha.')
    const date = (value: unknown) => {
      if (!value) return null
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('Fecha inválida')
      return new Date(value).toISOString()
    }
    const { supabase } = await getSessionUser()
    const visible = await supabase.from('leads').select('id,assigned_to').eq('id', input.leadId).maybeSingle()
    if (visible.error || !visible.data) throw new Error('Contacto fuera de alcance')
    if (session.profile.role !== 'admin' && visible.data.assigned_to && visible.data.assigned_to !== session.user.id)
      throw new Error('Esta gestión debe guardarla el responsable del lead o un administrador.')
    const { error } = await supabase.rpc('save_lead_commercial_profile', { p_lead_id: input.leadId,
      p_nutrition_active: input.nutritionActive, p_nutrition_reason: trim(input.nutritionReason),
      p_purchase_horizon: trim(input.purchaseHorizon), p_nutrition_evidence: trim(input.nutritionEvidence), p_contact_consent: input.contactConsent,
      p_resume_at: date(input.resumeAt), p_next_action: trim(input.nextAction), p_next_action_at: date(input.nextActionAt),
      p_opportunity_status: input.opportunityStatus, p_closure_reason: trim(input.closureReason) })
    if (error) {
      if (['PGRST202', '42P01', '42883'].includes(error.code)) throw new Error('Falta aplicar la migración del embudo para guardar esta ficha.')
      throw new Error('No se pudo guardar la ficha con sus permisos actuales. Compruebe los datos y vuelva a intentar.')
    }
    revalidatePath('/inmobiliaria/leads')
    revalidatePath('/inmobiliaria/automatizacion')
    return { ok: true }
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se pudo guardar la ficha comercial.' } }
}
