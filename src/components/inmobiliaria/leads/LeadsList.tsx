'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { formatDate } from '@/lib/utils'
import type { Lead } from '@/types/inmobiliaria'

const SOURCE_LABELS: Record<string, string> = {
  waba: 'WhatsApp',
  whatsapp: 'WhatsApp',
  referido: 'Referido',
  portal_web: 'Portal web',
  instagram: 'Instagram',
  facebook_ads: 'Facebook Ads',
  google_ads: 'Google Ads',
  showroom: 'Showroom',
}

function sourceLabel(source: string | null | undefined): string {
  const raw = source?.trim()
  if (!raw) return '—'
  return SOURCE_LABELS[raw.toLowerCase()] ?? raw
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
