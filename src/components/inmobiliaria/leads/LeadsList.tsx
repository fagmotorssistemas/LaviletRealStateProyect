'use client'

import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { formatDate } from '@/lib/utils'
import type { Lead } from '@/types/inmobiliaria'

interface LeadsListProps {
  leads: Lead[]
  onSelect: (lead: Lead) => void
}

export function LeadsList({ leads, onSelect }: LeadsListProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Teléfono</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Asignado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Fuente</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Creado</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              onClick={() => onSelect(lead)}
              className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">{lead.name}</td>
              <td className="px-4 py-3">
                <StatusBadge status={lead.status} type="lead" />
              </td>
              <td className="px-4 py-3 text-gray-600">{lead.phone ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">
                {lead.email ? <span className="block truncate max-w-[240px]">{lead.email}</span> : '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">{lead.assigned_profile?.full_name ?? '—'}</td>
              <td className="px-4 py-3">
                {lead.source ? (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {lead.source}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDate(lead.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
