'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { purposeLabel, sourceLabel } from '@/lib/inmobiliaria/leadAutomation'
import { formatDateTime } from '@/lib/utils'
import type { LeadAutomationRow } from '@/types/leadAutomation'

interface AutomationLeadsTableProps {
  rows: LeadAutomationRow[]
  selectedLeadId: string | null
  onSelect: (leadId: string) => void
}

export function AutomationLeadsTable({ rows, selectedLeadId, onSelect }: AutomationLeadsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full min-w-[78rem] text-sm">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left">Lead</th>
            <th className="px-4 py-3 text-left">Teléfono</th>
            <th className="px-4 py-3 text-left">Origen</th>
            <th className="px-4 py-3 text-left">Campaña</th>
            <th className="px-4 py-3 text-left">Etapa</th>
            <th className="px-4 py-3 text-left">Temperatura</th>
            <th className="px-4 py-3 text-left">Puntos</th>
            <th className="px-4 py-3 text-left">Interés</th>
            <th className="px-4 py-3 text-left">Propósito</th>
            <th className="px-4 py-3 text-left">Responsable</th>
            <th className="px-4 py-3 text-left">Traspaso</th>
            <th className="px-4 py-3 text-left">Bot</th>
            <th className="px-4 py-3 text-left">Última interacción</th>
            <th className="px-4 py-3 text-left">Límite de respuesta</th>
            <th className="px-4 py-3 text-left">SLA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.lead_id}
              onClick={() => onSelect(row.lead_id)}
              className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${
                selectedLeadId === row.lead_id ? 'bg-[#f7f3ee]' : ''
              }`}
            >
              <td className="px-4 py-3 font-semibold text-[#555850]">{row.name}</td>
              <td className="px-4 py-3 crm-num text-gray-600">{row.phone ?? '—'}</td>
              <td className="px-4 py-3">
                <span className="inline-flex min-w-[7.5rem] items-center justify-center rounded-full border border-[#2B1A18]/12 bg-[#f4f4ef] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-[#555850]">
                  {sourceLabel(row.source)}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">{row.campaign ?? '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.stage} type="stage" />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.temperature} type="temperature" />
              </td>
              <td className="px-4 py-3 crm-num font-semibold text-[#555850]">{row.score}</td>
              <td className="px-4 py-3 text-gray-600">{row.preferred_category ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">{purposeLabel(row.purchase_purpose)}</td>
              <td className="px-4 py-3">
                <PersonCell name={row.assignee_name} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.handoff_status} type="handoff" />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={row.bot_enabled ? 'activo' : 'desactivado'} type="bot" />
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDateTime(row.last_interaction_at) || '—'}</td>
              <td className="px-4 py-3 text-gray-600">{formatDateTime(row.seller_response_due_at) || '—'}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.sla_status} type="sla" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

