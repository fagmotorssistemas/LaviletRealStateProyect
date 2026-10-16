'use client'

import type { ReactNode } from 'react'
import type { AutomationTimelineItem, LeadAutomationDetail } from '@/types/leadAutomation'
import type { LeadPipelineDetail } from '@/types/leadPipelineDetail'
import { purposeLabel, sourceLabel, temperatureLabel } from '@/lib/inmobiliaria/leadAutomation'
import { formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { LeadPipelineWarnings } from '@/components/inmobiliaria/leads/LeadPipelineWarnings'
import { nextActionDescription, selectedUnitDescription } from '@/lib/inmobiliaria/leadPipeline'

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-[#2B1A18]/8 bg-[#fcfbf9] p-3">
    <dt className="text-xs text-[#797d70]">{label}</dt>
    <dd className="mt-1 break-words text-sm font-semibold text-[#555850]">{children || 'Sin confirmar'}</dd>
  </div>
}

export function AutomationTimelineList({ items, onOpenMessage }: { items: AutomationTimelineItem[]; onOpenMessage: (id: string) => void }) {
  if (!items.length) return <p className="text-sm text-[#6e716b]">No hay registros disponibles en esta vista.</p>
  return <ol className="space-y-3">{items.map(item => <li key={item.id} className="rounded-lg border border-[#2B1A18]/8 bg-[#fcfbf9] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <h4 className="text-sm font-semibold text-[#555850]">{item.title}</h4>
      {item.points !== undefined && <span className="shrink-0 rounded-full bg-[#edf1e7] px-2 py-0.5 text-sm font-semibold tabular-nums text-[#526444]">{item.points > 0 ? '+' : ''}{item.points} puntos</span>}
    </div>
    {item.detail && <p className="mt-1 text-sm leading-6 text-[#6e716b]">{item.detail}</p>}
    {item.score != null && <p className="mt-1 text-sm text-[#555850]">Puntuación registrada en ese cambio: {item.score} puntos</p>}
    <p className="mt-2 text-xs text-[#8a8d82]">{item.eventType ? 'Registro de la señal: ' : ''}{formatAgendaDateTime(item.at)} · Hora de Ecuador</p>
    {item.messageId && <button type="button" onClick={() => onOpenMessage(item.messageId!)} className="mt-2 rounded text-xs font-medium text-[#63764f] underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[#787D62]">Ver mensaje en la conversación</button>}
    {item.eventType && <details className="mt-2 text-xs text-[#8a8d82]">
      <summary className="cursor-pointer">Detalle del registro</summary>
      <dl className="mt-2 space-y-1 break-words">
        <div><dt className="inline font-medium">Código: </dt><dd className="inline">{item.eventType}</dd></div>
        {item.originalReason && <div><dt className="inline font-medium">Motivo guardado: </dt><dd className="inline">{item.originalReason}</dd></div>}
        <div><dt className="inline font-medium">Mensaje de origen: </dt><dd className="inline">{item.sourceMessageId || 'Sin referencia registrada'}</dd></div>
      </dl>
    </details>}
  </li>)}</ol>
}

export function AutomationLeadSummary({ detail, commercial, onRetry, onOpenMessage }: {
  detail: LeadAutomationDetail; commercial?: LeadPipelineDetail; onRetry: () => void; onOpenMessage: (id: string) => void
}) {
  const { row } = detail
  const pipeline = commercial?.pipeline || row.pipeline
  return <div className="space-y-5">
    <section>
      <h3 className="mb-3 font-display text-lg font-semibold text-[#4a4d48]">Situación actual del lead</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Etapa comercial">{pipeline?.stageLabel || 'Etapa por verificar'}{pipeline?.stageProvisional && ' · Provisional'}</Fact>
        <Fact label="Atención">{pipeline?.attentionLabel || 'Por verificar'}</Fact>
        <Fact label="Puntuación actual y temperatura">{row.score} puntos · {temperatureLabel(row.temperature)}</Fact>
        <Fact label="Unidad elegida">{pipeline ? selectedUnitDescription(pipeline) : 'Elección por verificar'}</Fact>
        <Fact label="Cita">{pipeline?.appointment ? <>{pipeline.appointment.label}{pipeline.appointment.scheduledAt && ` · ${formatAgendaDateTime(pipeline.appointment.scheduledAt)}`}</> : pipeline?.coverage.appointments === false ? 'Por verificar' : 'Sin cita registrada'}</Fact>
        <Fact label="Nutrición">{pipeline?.nutritionKnown === false ? 'Por verificar' : pipeline?.nutritionActive ? 'Activa · compra futura con contacto acordado' : 'Sin pausa activa registrada'}</Fact>
        <Fact label="Próxima acción">{pipeline ? nextActionDescription(pipeline) : 'Por verificar'}</Fact>
        <Fact label="Responsable">{row.assignee_name || 'Sin asignar'}</Fact>
      </dl>
      <p className="mt-3 text-sm leading-6 text-[#6e716b]">{pipeline?.stageReason}</p>
      <p className="mt-2 text-xs leading-5 text-[#8a8d82]">Los puntos valoran señales de interacción. No representan un porcentaje de compra ni confirman una cita, reserva o aprobación de crédito. Cada incremento de abajo ya forma parte del historial; no se suma otra vez al verlo.</p>
    </section>
    <LeadPipelineWarnings warnings={commercial?.warnings || pipeline?.warnings} issues={commercial?.issues || pipeline?.issues} onRetry={onRetry} />
    {detail.commercialProfileError && !commercial && <div role="alert" className="rounded-lg border border-amber-200 p-3 text-sm text-[#75613f]">{detail.commercialProfileError}<button type="button" onClick={onRetry} className="ml-2 underline">Reintentar</button></div>}
    <details className="rounded-lg border border-[#2B1A18]/8 p-3">
      <summary className="cursor-pointer text-sm font-medium text-[#555850]">Origen e integración</summary>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        <Fact label="Proyecto">{row.project_name}</Fact><Fact label="Origen">{sourceLabel(row.source)}</Fact>
        <Fact label="Canal">{row.channel}</Fact><Fact label="Campaña">{row.campaign}</Fact>
        <Fact label="Propósito">{purposeLabel(row.purchase_purpose)}</Fact>
        <Fact label="Última interacción">{formatAgendaDateTime(row.last_interaction_at)}</Fact>
        <Fact label="Identificador de responsable en Kommo">{row.assignee_kommo_id}</Fact>
        <Fact label="Identificador del lead en Kommo">{row.lead_kommo_id != null ? String(row.lead_kommo_id) : null}</Fact>
      </dl>
    </details>
    <section><h3 className="mb-3 font-display text-lg font-semibold text-[#4a4d48]">Actividad y puntos</h3>
      <AutomationTimelineList items={detail.timeline} onOpenMessage={onOpenMessage} />
    </section>
  </div>
}
