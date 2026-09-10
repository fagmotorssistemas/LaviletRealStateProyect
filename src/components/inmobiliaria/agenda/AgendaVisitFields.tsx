'use client'

import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { addOneHour } from '@/lib/inmobiliaria/visitClock'
import { addYmd, ecuadorYmd } from '@/lib/inmobiliaria/agendaTime'
import { APPOINTMENT_LOCATION_OPTIONS } from '@/types/inmobiliaria'
import type { AppointmentLocationType, TeamProfile } from '@/types/inmobiliaria'

export type AgendaVisitFieldValues = {
  visitDate: string
  startHm: string
  endHm: string
  responsibleId: string
  meetingPlace: string
  locationType: AppointmentLocationType
}

interface AgendaVisitFieldsProps {
  values: AgendaVisitFieldValues
  advisors: TeamProfile[]
  onChange: (patch: Partial<AgendaVisitFieldValues>) => void
  disabled?: boolean
  showAssignment?: boolean
}

export function AgendaVisitFields({
  values,
  advisors,
  onChange,
  disabled,
  showAssignment = true,
}: AgendaVisitFieldsProps) {
  const today = ecuadorYmd()
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {[{ label: 'Hoy', day: today }, { label: 'Mañana', day: addYmd(today, 1) }].map(({ label, day }) => (
          <button key={day} type="button" disabled={disabled} aria-pressed={values.visitDate === day}
            onClick={() => onChange({ visitDate: day })}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${values.visitDate === day ? 'border-[#787d62] bg-[#edf2e7] text-[#526247]' : 'border-[#e3e6dc] text-[#7b8170] hover:bg-[#f8f9f5]'}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-[#858a7c]">Hora de Ecuador</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="agenda-visit-date"
          label="Fecha *"
          type="date"
          min={today}
          value={values.visitDate}
          required
          disabled={disabled}
          onChange={(e) => onChange({ visitDate: e.target.value })}
        />
        <Input
          id="agenda-visit-start"
          label="Hora de inicio *"
          type="time"
          value={values.startHm}
          required
          disabled={disabled}
          onChange={(e) =>
            onChange({
              startHm: e.target.value,
              endHm: addOneHour(e.target.value),
            })
          }
        />
      </div>
      <p className="text-xs text-[#858a7c]">Duración: 60 minutos{values.endHm ? ` · Finaliza a las ${values.endHm}` : ''}</p>
      {showAssignment ? (
        <>
          <Select
            id="agenda-visit-advisor"
            label="Asesor responsable *"
            options={advisors.map((advisor) => ({
              value: advisor.id,
              label: advisor.full_name || advisor.id,
            }))}
            placeholder="Seleccionar asesor"
            value={values.responsibleId}
            required
            disabled={disabled}
            onChange={(e) => onChange({ responsibleId: e.target.value })}
          />
          <Select
            id="agenda-visit-location"
            label="Tipo de encuentro *"
            options={APPOINTMENT_LOCATION_OPTIONS}
            value={values.locationType}
            required
            disabled={disabled}
            onChange={(e) => onChange({ locationType: e.target.value as AppointmentLocationType })}
          />
          <Input
            id="agenda-visit-place"
            label="Lugar de encuentro *"
            placeholder="Ej: sala de ventas, portería del proyecto"
            value={values.meetingPlace}
            required
            disabled={disabled}
            onChange={(e) => onChange({ meetingPlace: e.target.value })}
          />
        </>
      ) : null}
    </div>
  )
}

export { addOneHour }
