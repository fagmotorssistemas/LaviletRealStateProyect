import type {
  AutomationTimelineItem,
  LeadAutomationDetail,
  LeadAutomationFilters,
  LeadAutomationKpis,
  LeadSlaStatus,
  MessageRow,
} from '@/types/leadAutomation'

export { computeSlaStatus, sanitizeSearch, toInclusiveRange } from '@/lib/inmobiliaria/slaStatus'

export const EMPTY_AUTOMATION_KPIS: LeadAutomationKpis = {
  leads_new: 0,
  leads_by_source: [],
  leads_by_stage: [],
  leads_cold: 0,
  leads_warm: 0,
  leads_hot: 0,
  reached_hot: 0,
  handed_off: 0,
  queued: 0,
  visits_requested: 0,
  visits_confirmed: 0,
  sla_overdue: 0,
  avg_first_response_minutes: null,
}

export const EMPTY_AUTOMATION_FILTERS: LeadAutomationFilters = {
  search: '',
  from: '',
  to: '',
  projectId: '',
  source: '',
  stage: '',
  temperature: '',
  assignedTo: '',
  handoff: '',
  bot: '',
  sla: '',
}

export const LEAD_STAGE_OPTIONS = [
  { value: 'lanzamiento', label: 'Lanzamiento' },
  { value: 'precalificacion', label: 'Precalificación' },
  { value: 'nutricion', label: 'Nutrición' },
  { value: 'preventa', label: 'Preventa' },
  { value: 'reserva_venta', label: 'Reserva / venta' },
]

export const HANDOFF_STATUS_OPTIONS = [
  { value: 'none', label: 'Sin traspaso' },
  { value: 'queued', label: 'En cola' },
  { value: 'assigned', label: 'Asignado' },
  { value: 'acknowledged', label: 'Reconocido' },
  { value: 'resolved', label: 'Resuelto' },
]

export const SLA_STATUS_OPTIONS = [
  { value: 'no_aplica', label: 'No aplica' },
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'vencido', label: 'Vencido' },
  { value: 'respondido', label: 'Respondido' },
]

export const BOT_STATUS_OPTIONS = [
  { value: 'activo', label: 'Bot activo' },
  { value: 'desactivado', label: 'Bot desactivado' },
]

export const SOURCE_LABELS: Record<string, string> = {
  waba: 'WhatsApp',
  whatsapp: 'WhatsApp',
  referido: 'Referido',
  portal_web: 'Portal web',
  instagram: 'Instagram',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  showroom: 'Showroom',
  sin_origen: 'Sin origen',
}

export function sourceLabel(source: string | null | undefined): string {
  const raw = source?.trim()
  if (!raw) return '—'
  return SOURCE_LABELS[raw.toLowerCase()] ?? raw
}

export function stageLabel(stage: string | null | undefined): string {
  return LEAD_STAGE_OPTIONS.find((option) => option.value === stage)?.label ?? stage?.replace(/_/g, ' ') ?? '—'
}

export function handoffLabel(status: string | null | undefined): string {
  return HANDOFF_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status ?? '—'
}

export function slaLabel(status: LeadSlaStatus | string | null | undefined): string {
  return SLA_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status ?? '—'
}

export function purposeLabel(purpose: string | null | undefined): string {
  const labels: Record<string, string> = {
    vivir: 'Vivir',
    invertir: 'Invertir',
    segunda_vivienda: 'Segunda vivienda',
    negocio: 'Negocio',
  }
  return purpose ? (labels[purpose] ?? purpose) : '—'
}

export function formatResponseMinutes(minutes: number | null | undefined): string {
  if (minutes == null || Number.isNaN(Number(minutes))) return '—'
  const value = Number(minutes)
  if (value < 60) return `${Math.round(value)} min`
  const hours = Math.floor(value / 60)
  const rest = Math.round(value % 60)
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function filtersFromSearchParams(params: URLSearchParams): LeadAutomationFilters {
  return {
    search: params.get('q') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    projectId: params.get('project') ?? '',
    source: params.get('origin') ?? '',
    stage: params.get('stage') ?? '',
    temperature: params.get('temperature') ?? '',
    assignedTo: params.get('assignee') ?? '',
    handoff: params.get('handoff') ?? '',
    bot: params.get('bot') ?? '',
    sla: params.get('sla') ?? '',
  }
}

export function searchParamsFromFilters(
  filters: LeadAutomationFilters,
  page: number,
  leadId: string | null,
): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.search) params.set('q', filters.search)
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (filters.projectId) params.set('project', filters.projectId)
  if (filters.source) params.set('origin', filters.source)
  if (filters.stage) params.set('stage', filters.stage)
  if (filters.temperature) params.set('temperature', filters.temperature)
  if (filters.assignedTo) params.set('assignee', filters.assignedTo)
  if (filters.handoff) params.set('handoff', filters.handoff)
  if (filters.bot) params.set('bot', filters.bot)
  if (filters.sla) params.set('sla', filters.sla)
  if (page > 1) params.set('page', String(page))
  if (leadId) params.set('lead', leadId)
  return params
}

export function hasActiveAutomationFilters(filters: LeadAutomationFilters): boolean {
  return Object.values(filters).some(Boolean)
}

const TIMELINE_TITLES: Record<AutomationTimelineItem['kind'], string> = {
  mensaje_recibido: 'Mensaje recibido',
  evento_detectado: 'Evento detectado',
  puntos_asignados: 'Puntos asignados',
  cambio_temperatura: 'Cambio de temperatura',
  cambio_etapa: 'Cambio de etapa',
  solicitud_visita: 'Solicitud de visita',
  solicitud_traspaso: 'Solicitud de traspaso',
  responsable_asignado: 'Responsable asignado',
  respuesta_vendedora: 'Respuesta de la vendedora',
}

export function timelineTitle(kind: AutomationTimelineItem['kind']): string {
  return TIMELINE_TITLES[kind]
}

function pushItem(
  items: AutomationTimelineItem[],
  kind: AutomationTimelineItem['kind'],
  at: string | null | undefined,
  id: string,
  detail: string | null,
) {
  if (!at) return
  items.push({ id, kind, at, title: TIMELINE_TITLES[kind], detail })
}

export function buildAutomationTimeline(detail: Omit<LeadAutomationDetail, 'timeline'>): AutomationTimelineItem[] {
  const items: AutomationTimelineItem[] = []
  const { row } = detail

  for (const message of detail.messages) {
    if (message.role === 'cliente') {
      pushItem(items, 'mensaje_recibido', message.sent_at, `msg-${message.id}`, clip(message.content))
    }
    if (message.role === 'asesor') {
      pushItem(items, 'respuesta_vendedora', message.sent_at, `seller-${message.id}`, clip(message.content))
    }
  }

  for (const event of detail.scoreEvents) {
    pushItem(items, 'evento_detectado', event.created_at, `evt-${event.id}`, event.event_type)
    pushItem(
      items,
      'puntos_asignados',
      event.created_at,
      `pts-${event.id}`,
      `${event.points > 0 ? '+' : ''}${event.points} · ${event.reason}`,
    )
  }

  for (const change of detail.temperatureHistory) {
    pushItem(
      items,
      'cambio_temperatura',
      change.created_at,
      `temp-${change.id}`,
      `${change.from_temperature ?? '—'} → ${change.to_temperature} · ${change.reason}`,
    )
  }

  for (const change of detail.stageHistory) {
    pushItem(
      items,
      'cambio_etapa',
      change.created_at,
      `stage-${change.id}`,
      `${stageLabel(change.from_stage)} → ${stageLabel(change.to_stage)} · ${change.reason}`,
    )
  }

  for (const visit of detail.visits) {
    pushItem(
      items,
      'solicitud_visita',
      visit.requested_at,
      `visit-${visit.id}`,
      `${visit.status}${visit.preferred_time_text ? ` · ${visit.preferred_time_text}` : ''}`,
    )
  }

  pushItem(items, 'solicitud_traspaso', row.handoff_requested_at, `handoff-${row.lead_id}`, row.handoff_reason)
  pushItem(
    items,
    'responsable_asignado',
    row.handoff_assigned_at,
    `assignee-${row.lead_id}`,
    row.assignee_name ?? row.assigned_to,
  )

  if (
    row.seller_first_response_at &&
    !detail.messages.some(
      (message: MessageRow) => message.role === 'asesor' && message.sent_at === row.seller_first_response_at,
    )
  ) {
    pushItem(items, 'respuesta_vendedora', row.seller_first_response_at, `first-response-${row.lead_id}`, null)
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

function clip(value: string | null | undefined, max = 140): string | null {
  if (!value?.trim()) return null
  const text = value.trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}
