'use client'

import { ArrowRight, Building2, CalendarDays, ChevronLeft, ChevronRight, Clock3, Leaf, UserRound } from 'lucide-react'
import { cn, formatDateTime } from '@/lib/utils'
import { LEAD_SOURCE_LABELS, normalizeSource } from '@/lib/leads/sources'
import { LEAD_PIPELINE_STAGE_OPTIONS, type LeadPipelineStage } from '@/types/leadPipeline'
import type { LeadPipelineCard, LeadPipelineColumn } from '@/hooks/inmobiliaria/useLeadPipeline'
import { coverageIncomplete } from '@/lib/inmobiliaria/leadPipelineDiagnostics'
import { nextActionDescription, selectedUnitDescription } from '@/lib/inmobiliaria/leadPipeline'

const STAGE_COLORS = ['#BDA27E', '#a3ab93', '#88997d', '#6e876c', '#a78d66', '#55765c']

function activityLabel(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin actividad registrada'
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000))
  if (minutes < 1) return 'Ahora'
  if (minutes < 60) return `Hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `Hace ${days} ${days === 1 ? 'día' : 'días'}`
  return new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value))
}

function validDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? formatDateTime(value) : null
}

function AppointmentBadge({ item }: { item: LeadPipelineCard }) {
  const appointment = item.pipeline.appointment
  if (!appointment) return null
  const confirmed = appointment.status === 'confirmed' || appointment.status === 'confirmada'
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] leading-4', confirmed ? 'border-[#87a082]/30 bg-[#edf3e9] text-[#45613f]' : 'border-[#BDA27E]/30 bg-[#faf5eb] text-[#806746]')}>
      <CalendarDays size={12} className="shrink-0" aria-hidden />
      <span>{appointment.label}{validDate(appointment.scheduledAt) ? ` · ${validDate(appointment.scheduledAt)}` : ''}</span>
    </span>
  )
}

function OutcomeBadge({ item }: { item: LeadPipelineCard }) {
  if (item.pipeline.opportunityStatus !== 'lost') return null
  return <span className="rounded-md bg-[#f5eae7] px-2 py-1 text-[10px] font-medium text-[#94635a]">Cerrado sin venta</span>
}

function PipelineCard({ item, onSelect }: { item: LeadPipelineCard; onSelect: (id: string) => void }) {
  const { lead, pipeline } = item
  const initials = (lead.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
  return (
    <button
      type="button"
      onClick={() => onSelect(lead.id)}
      aria-label={`Abrir ficha de ${lead.name || 'lead sin nombre'}`}
      className="group block w-full rounded-xl border border-[#787D62]/15 bg-white p-4 text-left shadow-[0_2px_7px_rgba(43,26,24,0.025)] transition hover:border-[#BDA27E] hover:shadow-[0_5px_14px_rgba(43,26,24,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62] focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f3efe7] text-[11px] font-semibold text-[#8b7656]" aria-hidden>{initials}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#444b3f]">{lead.name || 'Sin nombre'}</p>
          <p className="mt-0.5 truncate text-[11px] text-[#898c82]">{LEAD_SOURCE_LABELS[normalizeSource(lead.source || '')]}</p>
        </div>
        <ArrowRight size={14} className="mt-1 shrink-0 text-[#BDA27E] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {pipeline.stageProvisional && <span className="rounded-md bg-[#faf0dc] px-2 py-1 text-[10px] text-[#8b6b30]">Etapa por verificar</span>}
        {pipeline.nutritionKnown === false && <span className="rounded-md bg-[#faf0dc] px-2 py-1 text-[10px] text-[#8b6b30]">Nutrición por verificar</span>}
        {pipeline.nutritionActive && <span className="inline-flex items-center gap-1 rounded-md bg-[#edf1e7] px-2 py-1 text-[10px] font-medium text-[#65764d]"><Leaf size={11} aria-hidden />Nutrición activa</span>}
        <OutcomeBadge item={item} />
        <span className={cn('rounded-md px-2 py-1 text-[10px] font-medium', pipeline.attentionStatus === 'pendiente_equipo' || pipeline.attentionStatus === 'por_atender' ? 'bg-[#faf0dc] text-[#8b6b30]' : 'bg-[#f4f4ef] text-[#777d6a]')}>{pipeline.attentionLabel}</span>
      </div>

      <dl className="mt-3 space-y-2.5 text-xs">
        <div className="flex items-start gap-2"><dt className="mt-0.5 shrink-0 text-[#a0a391]"><Building2 size={13} aria-hidden /><span className="sr-only">Unidad elegida</span></dt><dd className="text-[#656c5b]">{selectedUnitDescription(pipeline)}</dd></div>
        <div className="flex items-start gap-2"><dt className="mt-0.5 shrink-0 text-[#a0a391]"><UserRound size={13} aria-hidden /><span className="sr-only">Responsable</span></dt><dd className="text-[#656c5b]">{lead.assigned_profile?.full_name || 'Sin asignar'}</dd></div>
        <div className="flex items-start gap-2" title={validDate(pipeline.lastActivityAt) || undefined}><dt className="mt-0.5 shrink-0 text-[#a0a391]"><Clock3 size={13} aria-hidden /><span className="sr-only">Última actividad</span></dt><dd className="text-[#898c82]">{activityLabel(pipeline.lastActivityAt)}</dd></div>
      </dl>

      {pipeline.appointment && <div className="mt-3"><AppointmentBadge item={item} /></div>}
      <div className="mt-3 border-t border-[#787D62]/10 pt-3">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#989c8b]">Próxima acción</p>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#626b57]">{nextActionDescription(pipeline)}</p>
        {pipeline.nextActionScheduled && validDate(pipeline.nextActionAt) && <p className="mt-1 text-[10px] text-[#9b896b]">{validDate(pipeline.nextActionAt)}</p>}
      </div>
    </button>
  )
}

interface LeadPipelineBoardProps {
  columns: LeadPipelineColumn[]
  stageFilter: LeadPipelineStage | ''
  isLoading: boolean
  onPageChange: (stage: LeadPipelineStage, page: number) => void
  onSelect: (id: string) => void
  coverage?: Record<string, boolean>
}

export function LeadPipelineBoard({ columns, stageFilter, isLoading, onPageChange, onSelect, coverage = {} }: LeadPipelineBoardProps) {
  const incomplete = coverageIncomplete(coverage)
  const stages = LEAD_PIPELINE_STAGE_OPTIONS.filter((stage) => !stageFilter || stage.value === stageFilter)
  return (
    <div aria-busy={isLoading}>
      <p className="mb-3 text-xs leading-5 text-[#858a7b]">Cada columna muestra el avance comercial. Las citas, la nutrición y la atención pendiente se conservan en la ficha.</p>
      <div role="region" aria-label="Embudo comercial de leads" tabIndex={0} className="overflow-x-auto rounded-xl pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62]">
        <div className={cn('flex items-stretch gap-3', isLoading && 'pointer-events-none opacity-60')}>
          {stages.map((stage) => {
            const column = columns.find((entry) => entry.stage === stage.value)
            const total = column?.total || 0
            const page = column?.page || 1
            const pageSize = column?.pageSize || 12
            const pageCount = Math.max(1, Math.ceil(total / pageSize))
            const stageIndex = LEAD_PIPELINE_STAGE_OPTIONS.findIndex((entry) => entry.value === stage.value)
            return (
              <section key={stage.value} aria-labelledby={`stage-${stage.value}`} className={cn('flex h-[min(760px,calc(100dvh-18rem))] min-h-[420px] w-[280px] min-w-[280px] flex-col rounded-xl border border-[#787D62]/12 bg-[#f3f3ed]/70', stageFilter && 'w-full max-w-[720px]')}>
                <div className="h-1 rounded-t-xl" style={{ backgroundColor: STAGE_COLORS[stageIndex] }} />
                <header className="flex min-h-20 shrink-0 items-start justify-between gap-3 px-4 py-4">
                  <div><h2 id={`stage-${stage.value}`} className="text-sm font-semibold text-[#555e48]">{stage.label}</h2><p className="mt-1 text-[11px] text-[#989d8e]">{total} {total === 1 ? 'lead' : 'leads'}{incomplete ? ' · Recuento provisional' : ''}</p></div>
                  <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-white px-1.5 text-xs font-semibold tabular-nums text-[#7d856d]">{total}</span>
                </header>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3">
                  {column?.leads.map((item) => <PipelineCard key={item.lead.id} item={item} onSelect={onSelect} />)}
                  {!column?.leads.length && <div className="rounded-lg border border-dashed border-[#787D62]/20 px-4 py-9 text-center text-xs text-[#9a9e91]">{incomplete ? 'Sin leads identificados con las fuentes disponibles. Pendiente de verificar.' : 'Sin leads en esta etapa'}</div>}
                </div>
                {total > pageSize && (
                  <div className="flex shrink-0 items-center justify-between border-t border-[#787D62]/10 px-3 py-3">
                    <span className="text-[10px] tabular-nums text-[#848b77]">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}</span>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label={`Página anterior de ${stage.label}`} disabled={isLoading || page <= 1} onClick={() => onPageChange(stage.value, page - 1)} className="rounded-md p-1 text-[#787D62] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62] disabled:opacity-30"><ChevronLeft size={16} /></button>
                      <span className="min-w-8 text-center text-[10px] text-[#848b77]">{page}/{pageCount}</span>
                      <button type="button" aria-label={`Página siguiente de ${stage.label}`} disabled={isLoading || page >= pageCount} onClick={() => onPageChange(stage.value, page + 1)} className="rounded-md p-1 text-[#787D62] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62] disabled:opacity-30"><ChevronRight size={16} /></button>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function LeadPipelineTable({ items, onSelect }: { items: LeadPipelineCard[]; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#787D62]/15 bg-white">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Leads con su etapa comercial, nutrición, cita y próxima acción</caption>
        <thead className="bg-[#f5f4ee] text-[10px] uppercase tracking-[0.12em] text-[#7b826e]"><tr>{['Lead', 'Etapa comercial', 'Nutrición', 'Unidad elegida', 'Responsable', 'Cita', 'Última actividad', 'Próxima acción'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3.5 font-semibold">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-[#787D62]/10">
          {items.map((item) => (
            <tr key={item.lead.id} className="transition-colors hover:bg-[#f9f8f3]">
              <th scope="row" className="min-w-44 px-4 py-4 font-normal"><button type="button" onClick={() => onSelect(item.lead.id)} className="rounded text-left font-semibold text-[#596a48] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#787D62]">{item.lead.name || 'Sin nombre'}</button><p className="mt-1 text-xs text-[#939789]">{item.lead.phone || LEAD_SOURCE_LABELS[normalizeSource(item.lead.source || '')]}</p></th>
              <td className="min-w-44 px-4 py-4"><p className="text-xs font-medium text-[#656f57]">{item.pipeline.stageLabel}{item.pipeline.stageProvisional ? ' · Por verificar' : ''}</p><p className="mt-1 text-[11px] text-[#939789]">{item.pipeline.attentionLabel}</p><div className="mt-1"><OutcomeBadge item={item} /></div></td>
              <td className="px-4 py-4 text-xs text-[#6e795e]">{item.pipeline.nutritionKnown === false ? 'Por verificar' : item.pipeline.nutritionActive ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Leaf size={12} aria-hidden />Activa</span> : <span className="whitespace-nowrap text-[#969b8b]">No activa</span>}</td>
              <td className="min-w-36 px-4 py-4 text-xs text-[#6e795e]">{selectedUnitDescription(item.pipeline)}</td>
              <td className="min-w-36 px-4 py-4 text-xs text-[#6e795e]">{item.lead.assigned_profile?.full_name || 'Sin asignar'}</td>
              <td className="min-w-44 px-4 py-4"><AppointmentBadge item={item} />{!item.pipeline.appointment && <span className="text-xs text-[#969b8b]">{item.pipeline.coverage?.appointments === false ? 'Citas por verificar' : 'Sin cita registrada'}</span>}</td>
              <td className="min-w-32 px-4 py-4 text-xs text-[#939789]" title={validDate(item.pipeline.lastActivityAt) || undefined}>{activityLabel(item.pipeline.lastActivityAt)}</td>
              <td className="min-w-56 px-4 py-4 text-xs leading-5 text-[#6e795e]"><p>{nextActionDescription(item.pipeline)}</p>{item.pipeline.nextActionScheduled && validDate(item.pipeline.nextActionAt) && <p className="mt-1 text-[10px] text-[#9b896b]">{validDate(item.pipeline.nextActionAt)}</p>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
