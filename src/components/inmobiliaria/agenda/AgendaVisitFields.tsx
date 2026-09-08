'use client'

import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { addOneHour } from '@/lib/inmobiliaria/visitClock'
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
  return (
    <div className="space-y-4">
      <p className="text-xs text-[#7a7e70]">Horario en Ecuador (America/Guayaquil). No se usa la zona del navegador.</p>
      <Input
        id="agenda-visit-date"
        label="Fecha *"
        type="date"
        value={values.visitDate}
        required
        disabled={disabled}
        onChange={(e) => onChange({ visitDate: e.target.value })}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
        <Input
          id="agenda-visit-end"
          label="Hora de fin (60 min)"
          type="time"
          value={values.endHm}
          required
          disabled
          onChange={() => undefined}
        />
      </div>
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
