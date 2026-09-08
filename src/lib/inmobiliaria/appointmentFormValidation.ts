/** Validación compartida: nueva cita y confirmación. Unidades opcionales. */

export interface AppointmentFormValues {
  title: string
  lead_id: string
  project_id: string
  start_time: string
  end_time: string
  notes?: string
  responsible_id?: string
  meeting_place?: string
  requireNotes?: boolean
  requireResponsible?: boolean
}

export function validateAppointmentForm(values: AppointmentFormValues): {
  missing: string[]
  endBeforeOrEqualStart: boolean
} {
  const missing: string[] = []
  if (!values.title.trim()) missing.push('Título')
  if (!values.lead_id) missing.push('Cliente')
  if (!values.project_id) missing.push('Proyecto')
  if (!values.start_time) missing.push('Fecha y hora de inicio')
  if (!values.end_time) missing.push('Fecha y hora de fin')
  if (values.requireNotes === true && !values.notes?.trim()) missing.push('Notas')
  if (values.requireResponsible && !values.responsible_id) missing.push('Asesor responsable')
  if (values.requireResponsible && !values.meeting_place?.trim()) missing.push('Lugar de encuentro')

  const endBeforeOrEqualStart = Boolean(
    values.start_time
    && values.end_time
    && new Date(values.end_time).getTime() <= new Date(values.start_time).getTime(),
  )

  return { missing, endBeforeOrEqualStart }
}

export function toastAppointmentValidationError(missing: string[], endBeforeOrEqualStart: boolean) {
  if (endBeforeOrEqualStart) {
    return 'La fecha y hora de fin deben ser posteriores a la de inicio.'
  }
  if (missing.length === 0) return null
  return `Faltan datos obligatorios: ${missing.join(', ')}.`
}
