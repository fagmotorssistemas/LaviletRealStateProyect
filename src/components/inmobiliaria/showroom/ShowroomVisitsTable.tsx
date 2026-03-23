'use client'

import { formatDateTime } from '@/lib/utils'
import type { ShowroomVisit } from '@/types/inmobiliaria'

interface ShowroomVisitsTableProps {
  visits: ShowroomVisit[]
  onSelect: (visit: ShowroomVisit) => void
}

const sourceLabels: Record<string, string> = {
  organica: 'Orgánica',
  redes_sociales: 'Redes sociales',
  referido: 'Referido',
  agendada: 'Cita agendada',
  otro: 'Otro',
  // Valores heredados (lógica anterior)
  oficina: 'Oficina',
  proyecto: 'Proyecto',
  mixto: 'Mixto',
}

export function ShowroomVisitsTable({ visits, onSelect }: ShowroomVisitsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">Cliente</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Asesor</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Proyecto</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Origen</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Inicio</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Fin</th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => (
            <tr
              key={visit.id}
              onClick={() => onSelect(visit)}
              className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">
                {visit.lead?.name ?? visit.client_name ?? '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {visit.salesperson?.full_name ?? '—'}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {visit.project?.name ?? '—'}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 capitalize">
                  {sourceLabels[visit.source] ?? visit.source}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDateTime(visit.visit_start)}</td>
              <td className="px-4 py-3 text-gray-600">{visit.visit_end ? formatDateTime(visit.visit_end) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
