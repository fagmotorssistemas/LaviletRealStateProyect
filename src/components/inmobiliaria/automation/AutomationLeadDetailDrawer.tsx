'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import {
  handoffLabel,
  purposeLabel,
  sourceLabel,
  stageLabel,
  timelineTitle,
} from '@/lib/inmobiliaria/leadAutomation'
import type { AutomationTimelineKind, LeadAutomationDetail } from '@/types/leadAutomation'

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'conversacion', label: 'Conversación' },
  { id: 'puntuacion', label: 'Puntuación' },
  { id: 'temperatura', label: 'Historial de temperatura' },
  { id: 'etapas', label: 'Historial de etapas' },
  { id: 'unidades', label: 'Unidades de interés' },
  { id: 'visitas', label: 'Visitas' },
  { id: 'consentimiento', label: 'Consentimiento' },
  { id: 'traspaso', label: 'Traspaso' },
  { id: 'nutricion', label: 'Nutrición' },
] as const

type TabId = (typeof TABS)[number]['id']

interface AutomationLeadDetailDrawerProps {
  isOpen: boolean
  loading: boolean
  error: string | null
  detail: LeadAutomationDetail | null
  onClose: () => void
}

export function AutomationLeadDetailDrawer({
  isOpen,
  loading,
  error,
  detail,
  onClose,
}: AutomationLeadDetailDrawerProps) {
  const [tab, setTab] = useState<TabId>('resumen')

  useEffect(() => {
    if (isOpen) setTab('resumen')
  }, [isOpen, detail?.row.lead_id])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const row = detail?.row

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="crm-modal-backdrop absolute inset-0 bg-[#2B1A18]/40" onClick={onClose} />
      <aside className="relative z-50 flex h-full w-full max-w-3xl flex-col bg-white shadow-[-18px_0_40px_rgba(43,26,24,0.12)]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#2B1A18]/8 bg-[#f7f3ee] px-5 py-4">
          <div className="min-w-0">
            <p className="crm-eyebrow">Detalle de automatización</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#4a4d48]">{row?.name ?? 'Lead'}</h2>
            <p className="mt-1 text-sm text-[#6e716b]">{row?.phone ?? 'Sin teléfono'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer p-1.5 text-[#8a8d87] transition-colors hover:text-[#BDA27E]"
            aria-label="Cerrar detalle"
          >
            <X size={20} />
          </button>
        </header>

        <div className="crm-tabs mx-5 mt-4 shrink-0">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="crm-tab"
              data-active={tab === item.id ? 'true' : 'false'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          ) : error ? (
            <EmptyState title="No se pudo cargar el detalle" description={error} icon={X} />
          ) : !detail || !row ? (
            <EmptyState title="Selecciona un lead" description="Abre una fila para ver el historial completo." icon={X} />
          ) : (
            <TabBody tab={tab} detail={detail} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function TabBody({ tab, detail }: { tab: TabId; detail: LeadAutomationDetail }) {
  const { row } = detail
  if (tab === 'resumen') {
    return (
      <div className="space-y-5">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label="Proyecto" value={row.project_name} />
          <Fact label="Origen" value={sourceLabel(row.source)} />
          <Fact label="Canal" value={row.channel} />
          <Fact label="Campaña" value={row.campaign} />
          <Fact label="Etapa" value={stageLabel(row.stage)} />
          <Fact label="Motivo de etapa" value={row.stage_reason ?? row.last_stage_reason} />
          <Fact label="Temperatura" value={row.temperature} />
          <Fact label="Puntos" value={String(row.score)} />
          <Fact label="Interés" value={row.preferred_category} />
          <Fact label="Propósito" value={purposeLabel(row.purchase_purpose)} />
          <Fact label="Responsable" value={row.assignee_name} />
          <Fact label="Kommo vendedora" value={row.assignee_kommo_id} />
          <Fact label="Kommo lead" value={row.lead_kommo_id != null ? String(row.lead_kommo_id) : null} />
          <Fact label="Última interacción" value={formatDateTime(row.last_interaction_at)} />
        </dl>
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold text-[#4a4d48]">Línea de tiempo</h3>
          {detail.timeline.length === 0 ? (
            <p className="text-sm text-[#6e716b]">Aún no hay eventos registrados para este lead.</p>
          ) : (
            <ol className="space-y-3">
              {detail.timeline.map((item) => (
                <li key={item.id} className="border border-[#2B1A18]/8 bg-[#fcfbf9] px-3 py-2.5">
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                    {timelineTitle(item.kind as AutomationTimelineKind)}
                  </p>
                  <p className="mt-1 text-sm font-medium text-[#555850]">{item.detail ?? item.title}</p>
                  <p className="mt-1 text-xs text-[#6e716b]">{formatDateTime(item.at)}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    )
  }

  if (tab === 'conversacion') {
    return detail.messages.length === 0 ? (
      <p className="text-sm text-[#6e716b]">No hay mensajes en conversaciones de este lead.</p>
    ) : (
      <ol className="space-y-3">
        {detail.messages.map((message) => (
          <li key={message.id} className="border border-[#2B1A18]/8 px-3 py-2.5">
            <p className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
              {message.role} · {formatDateTime(message.sent_at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[#555850]">{message.content || message.media_url || '—'}</p>
          </li>
        ))}
      </ol>
    )
  }

  if (tab === 'puntuacion') {
    return detail.scoreEvents.length === 0 ? (
      <p className="text-sm text-[#6e716b]">Este lead todavía no tiene eventos de puntuación.</p>
    ) : (
      <ol className="space-y-3">
        {detail.scoreEvents.map((event) => (
          <li key={event.id} className="border border-[#2B1A18]/8 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-[#555850]">{event.event_type}</p>
              <p className="crm-num text-sm font-bold text-[#555850]">
                {event.points > 0 ? '+' : ''}
                {event.points}
              </p>
            </div>
            <p className="mt-1 text-sm text-[#6e716b]">{event.reason}</p>
            <p className="mt-1 text-xs text-[#8a8d82]">{formatDateTime(event.created_at)}</p>
          </li>
        ))}
      </ol>
    )
  }

  if (tab === 'temperatura') {
    return detail.temperatureHistory.length === 0 ? (
      <p className="text-sm text-[#6e716b]">No hay cambios de temperatura registrados.</p>
    ) : (
      <ol className="space-y-3">
        {detail.temperatureHistory.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 border border-[#2B1A18]/8 px-3 py-2.5">
            <StatusBadge status={item.from_temperature || 'frio'} type="temperature" />
            <span className="text-xs text-[#8a8d82]">→</span>
            <StatusBadge status={item.to_temperature} type="temperature" />
            <p className="w-full text-sm text-[#6e716b]">{item.reason}</p>
            <p className="text-xs text-[#8a8d82]">{formatDateTime(item.created_at)}</p>
          </li>
        ))}
      </ol>
    )
  }

  if (tab === 'etapas') {
    return detail.stageHistory.length === 0 ? (
      <p className="text-sm text-[#6e716b]">No hay cambios de etapa registrados.</p>
    ) : (
      <ol className="space-y-3">
        {detail.stageHistory.map((item) => (
          <li key={item.id} className="border border-[#2B1A18]/8 px-3 py-2.5">
            <p className="text-sm font-semibold text-[#555850]">
              {stageLabel(item.from_stage)} → {stageLabel(item.to_stage)}
            </p>
            <p className="mt-1 text-sm text-[#6e716b]">{item.reason}</p>
            <p className="mt-1 text-xs text-[#8a8d82]">{formatDateTime(item.created_at)}</p>
          </li>
        ))}
      </ol>
    )
  }

  if (tab === 'unidades') {
    return detail.units.length === 0 ? (
      <p className="text-sm text-[#6e716b]">Este lead no tiene unidades de interés.</p>
    ) : (
      <ul className="space-y-3">
        {detail.units.map((item) => (
          <li key={`${item.lead_id}-${item.unit_id}`} className="border border-[#2B1A18]/8 px-3 py-2.5">
            <p className="font-semibold text-[#555850]">{item.unit?.unit_number ?? item.unit_id}</p>
            <p className="text-sm text-[#6e716b]">
              {item.unit?.category ?? 'Unidad'} · {item.interest_level ?? 'sin nivel'} · {formatCurrency(item.unit?.published_commercial_price)}
            </p>
            {item.rejected && <p className="mt-1 text-sm text-[#8a5c58]">{item.rejection_reason ?? 'Rechazada'}</p>}
          </li>
        ))}
      </ul>
    )
  }

  if (tab === 'visitas') {
    return detail.visits.length === 0 ? (
      <p className="text-sm text-[#6e716b]">No hay visitas solicitadas.</p>
    ) : (
      <ul className="space-y-3">
        {detail.visits.map((visit) => (
          <li key={visit.id} className="border border-[#2B1A18]/8 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={visit.status} type="appointment" />
              {visit.confirmed_by_client && <span className="text-[11px] font-semibold text-[#4d5c50]">Confirmada</span>}
            </div>
            <p className="mt-2 text-sm text-[#6e716b]">Solicitada {formatDateTime(visit.requested_at)}</p>
            {visit.preferred_time_text && <p className="text-sm text-[#6e716b]">Horario preferido: {visit.preferred_time_text}</p>}
            {visit.units?.length ? (
              <p className="mt-1 text-sm text-[#555850]">Unidades: {visit.units.map((unit) => unit.unit_number).join(', ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    )
  }

  if (tab === 'consentimiento') {
    return (
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Seguimiento" value={row.tracking_consent ? 'Con consentimiento' : 'Sin consentimiento'} />
        <Fact label="Fecha de consentimiento" value={formatDateTime(row.tracking_consent_at)} />
        <Fact label="Opt-out" value={formatDateTime(row.tracking_opt_out_at)} />
        <Fact label="Motivo de opt-out" value={row.tracking_opt_out_reason} />
      </dl>
    )
  }

  if (tab === 'traspaso') {
    return (
      <div className="space-y-4">
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label="Estado" value={handoffLabel(row.handoff_status)} />
          <Fact label="Motivo" value={row.handoff_reason} />
          <Fact label="Solicitado" value={formatDateTime(row.handoff_requested_at)} />
          <Fact label="Asignado" value={formatDateTime(row.handoff_assigned_at)} />
          <Fact label="Responsable" value={row.assignee_name} />
          <Fact label="Límite de respuesta" value={formatDateTime(row.seller_response_due_at)} />
          <Fact label="Primera respuesta" value={formatDateTime(row.seller_first_response_at)} />
          <Fact label="Escalado a admin" value={formatDateTime(row.admin_escalated_at)} />
        </dl>
        {detail.escalations.length > 0 && (
          <section>
            <h3 className="mb-2 font-display text-lg font-semibold text-[#4a4d48]">Escalamientos</h3>
            <ul className="space-y-2">
              {detail.escalations.map((item) => (
                <li key={item.id} className="border border-[#2B1A18]/8 px-3 py-2 text-sm text-[#6e716b]">
                  {item.reason ?? 'Sin motivo'} · {formatDateTime(item.escalated_at)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {detail.nutrition ? (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fact label="Próxima semana" value={String(detail.nutrition.next_week)} />
          <Fact label="Próximo envío" value={formatDateTime(detail.nutrition.next_send_at)} />
          <Fact label="Último envío" value={formatDateTime(detail.nutrition.last_sent_at)} />
          <Fact label="Completada" value={formatDateTime(detail.nutrition.completed_at)} />
          <Fact label="Pausada" value={formatDateTime(detail.nutrition.paused_at)} />
          <Fact label="Último error" value={detail.nutrition.last_error} />
        </dl>
      ) : (
        <p className="text-sm text-[#6e716b]">Este lead no está inscrito en nutrición.</p>
      )}
      {detail.nutritionHistory.length > 0 && (
        <ul className="space-y-2">
          {detail.nutritionHistory.map((item) => (
            <li key={item.id} className="border border-[#2B1A18]/8 px-3 py-2 text-sm text-[#6e716b]">
              Semana {item.week_number} · {item.meta_template_name} · {item.status}
              {item.error ? ` · ${item.error}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border border-[#2B1A18]/8 bg-[#fcfbf9] px-3 py-2.5">
      <dt className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-[#555850]">{value || '—'}</dd>
    </div>
  )
}
