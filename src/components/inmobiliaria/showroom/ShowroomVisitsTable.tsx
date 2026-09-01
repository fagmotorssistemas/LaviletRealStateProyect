'use client'

import { Building2, Clock, CreditCard, Pencil, User } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { formatClock, formatVisitDuration, getInitials } from '@/lib/utils'
import type { ShowroomVisit } from '@/types/inmobiliaria'

interface ShowroomVisitsTableProps {
  visits: ShowroomVisit[]
  onSelect: (visit: ShowroomVisit) => void
  onEdit: (visit: ShowroomVisit) => void
}

const sourceLabels: Record<string, string> = {
  organica: 'Showroom',
  redes_sociales: 'Redes sociales',
  referido: 'Referido',
  agendada: 'Cita agendada',
  otro: 'Otro',
  oficina: 'Oficina',
  proyecto: 'Proyecto',
  mixto: 'Mixto',
}

const sourceStyles: Record<string, string> = {
  organica: 'border-[#8b917c] bg-[#8b917c]/15 text-[#3a3d36]',
  referido: 'border-[#3d5c45]/40 bg-[#3d5c45]/10 text-[#2c4634]',
  agendada: 'border-[#3a3d36]/30 bg-[#3a3d36]/8 text-[#3a3d36]',
  redes_sociales: 'border-[#9a6b2f]/40 bg-[#9a6b2f]/12 text-[#6b4a20]',
  oficina: 'border-[#8b917c]/50 bg-[#f7f7f3] text-[#3a3d36]',
  proyecto: 'border-[#8b917c] bg-[#ead9be]/40 text-[#3a3d36]',
  mixto: 'border-[#6b5348]/30 bg-[#f7f7f3] text-[#6b5348]',
  otro: 'border-[#6b5348]/30 bg-[#f7f7f3] text-[#6b5348]',
}

function interestLabel(visit: ShowroomVisit): string {
  const units = visit.units ?? []
  if (units.length) {
    const first = units[0]
    const project = first.project?.name
    const line = [project, first.unit_number].filter(Boolean).join(' · ')
    if (units.length === 1) return line
    return `${line} +${units.length - 1}`
  }
  return visit.project?.name ?? '—'
}

function creditState(visit: ShowroomVisit): 'aplica' | 'pendiente' | 'no' {
  if (!visit.lead) return 'pendiente'
  if (visit.lead.financing === true) return 'aplica'
  if (visit.lead.financing === false) return 'no'
  return 'pendiente'
}

export function ShowroomVisitsTable({ visits, onSelect, onEdit }: ShowroomVisitsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#3a3d36] text-white">
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Cliente</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Horario / Duración</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Interés</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Origen</th>
            <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider">Crédito</th>
            <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider"> </th>
          </tr>
        </thead>
        <tbody>
          {visits.map((visit) => {
            const clientName = visit.lead?.name ?? visit.client_name ?? 'Sin nombre'
            const advisorName = visit.salesperson?.full_name
            const advisorFirst = advisorName?.trim().split(/\s+/)[0]
            const duration = formatVisitDuration(visit.visit_start, visit.visit_end)
            const credit = creditState(visit)
            const interest = interestLabel(visit)
            const sourceKey = visit.source

            return (
              <tr
                key={visit.id}
                className="border-b border-gray-100 hover:bg-gray-50/80 transition-colors"
              >
                <td className="px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                      {getInitials(clientName)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{clientName}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                        <User size={12} className="shrink-0" />
                        {advisorFirst ? `${advisorFirst} (Asesor)` : 'Sin asesor'}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-start gap-2 text-slate-800">
                    <Clock size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <div>
                      <p className="font-medium">
                        {formatClock(visit.visit_start)}
                        {visit.visit_end ? ` – ${formatClock(visit.visit_end)}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {duration ?? (visit.visit_end ? '—' : 'En curso')}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex min-w-0 items-start gap-2">
                    <Building2 size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <p className="min-w-0 text-sm text-slate-700">
                      {interest === '—' ? (
                        <span className="text-slate-400">Sin unidad</span>
                      ) : (
                        interest
                      )}
                    </p>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                      sourceStyles[sourceKey] ?? 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    {sourceLabels[sourceKey] ?? sourceKey}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {credit === 'aplica' ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      <CreditCard size={12} />
                      Aplica
                    </span>
                  ) : credit === 'no' ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      <CreditCard size={12} />
                      No aplica
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                      <CreditCard size={12} />
                      Pendiente
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onSelect(visit)}
                    >
                      Gestionar
                    </Button>
                    <button
                      type="button"
                      onClick={() => onEdit(visit)}
                      title="Editar visita"
                      className="rounded-lg p-2 text-sky-600 hover:bg-sky-50 transition-colors cursor-pointer"
                    >
                      <Pencil size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
