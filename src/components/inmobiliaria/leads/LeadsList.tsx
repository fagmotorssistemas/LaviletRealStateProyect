'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { formatDate } from '@/lib/utils'
import { LEAD_SOURCE_LABELS, normalizeSource } from '@/lib/leads/sources'
import type { Lead } from '@/types/inmobiliaria'

function sourceLabel(source: string | null | undefined): string {
  const raw = source?.trim()
  if (!raw) return '—'
  return LEAD_SOURCE_LABELS[normalizeSource(raw)]
}

const ACTIVITY_SOURCE_LABELS: Record<NonNullable<Lead['last_activity_source']>, string> = {
  showroom: 'Showroom',
  whatsapp: 'WhatsApp',
  solicitud: 'Solicitud',
  crm: 'CRM',
}

function relativeActivity(value: string | null): string {
  if (!value) return '—'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '—'
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000))
  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} días`
  const months = Math.floor(days / 30)
  if (months < 12) return `hace ${months} ${months === 1 ? 'mes' : 'meses'}`
  const years = Math.floor(days / 365)
  return `hace ${years} ${years === 1 ? 'año' : 'años'}`
}

interface LeadsListProps {
  leads: Lead[]
  onSelect: (lead: Lead) => void
}

export function LeadsList({ leads, onSelect }: LeadsListProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="px-4 py-3 text-left">Lead</th>
            <th className="px-4 py-3 text-left">Teléfono</th>
            <th className="px-4 py-3 text-left">Responsable</th>
            <th className="px-4 py-3 text-left">Fuente</th>
            <th className="px-4 py-3 text-left">Última actividad</th>
            <th className="px-4 py-3 text-left">Creado</th>
            <th className="px-4 py-3 text-left">Temperatura</th>
            <th className="px-4 py-3 text-left">Estado</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              onClick={() => onSelect(lead)}
              className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-semibold text-[#555850]">{lead.name}</td>

              <td className="px-4 py-3 crm-num text-gray-600">{lead.phone ?? '—'}</td>
              <td className="px-4 py-3">
                <PersonCell
                  name={lead.assigned_profile?.full_name}
                  avatarUrl={lead.assigned_profile?.avatar_url}
                />
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex w-[9rem] items-center justify-center rounded-full border border-[#2B1A18]/12 bg-[#f4f4ef] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap text-[#555850]">
                  {sourceLabel(lead.source)}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600 whitespace-nowrap" title={lead.last_activity_at ? formatDate(lead.last_activity_at) : undefined}>
                {relativeActivity(lead.last_activity_at)}
                {lead.last_activity_source ? ` · ${ACTIVITY_SOURCE_LABELS[lead.last_activity_source]}` : ''}
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDate(lead.created_at)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={lead.temperature || 'frio'} type="temperature" />
                  {(lead.temperature_score ?? 0) > 0 && (
                    <span className="text-[11px] text-gray-400 tabular-nums">{lead.temperature_score}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={lead.status} type="lead" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
