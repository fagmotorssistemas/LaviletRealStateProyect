import type { BusinessHours, ProjectAutomationConfig } from '../../types/automationRules'

const WEEKDAYS: { iso: string; label: string }[] = [
  { iso: '1', label: 'Lunes' },
  { iso: '2', label: 'Martes' },
  { iso: '3', label: 'Miércoles' },
  { iso: '4', label: 'Jueves' },
  { iso: '5', label: 'Viernes' },
  { iso: '6', label: 'Sábado' },
  { iso: '7', label: 'Domingo' },
]

export type WeekdayHours = {
  iso: string
  label: string
  enabled: boolean
  open: string
  close: string
}

export function defaultBusinessHours(): BusinessHours {
  return {
    '1': { open: '08:30', close: '18:30' },
    '2': { open: '08:30', close: '18:30' },
    '3': { open: '08:30', close: '18:30' },
    '4': { open: '08:30', close: '18:30' },
    '5': { open: '08:30', close: '18:30' },
    '6': { open: '09:30', close: '13:30' },
  }
}

export function defaultAutomationConfig(
  projectId: string,
  tenantId: string,
): ProjectAutomationConfig {
  return {
    project_id: projectId,
    tenant_id: tenantId,
    mode: 'lanzamiento',
    timezone: 'America/Guayaquil',
    business_hours: defaultBusinessHours(),
    admin_profile_id: null,
    is_active: true,
    sla_response_minutes: 120,
    temperature_warm_min: 25,
    temperature_hot_min: 60,
    visit_location_url: null,
    review_sla_minutes: 90,
    proposal_hold_minutes: 120,
    max_auto_reassignments: 3,
    updated_at: null,
  }
}

export function hoursToWeekdays(hours: BusinessHours | null | undefined): WeekdayHours[] {
  const source = hours && typeof hours === 'object' ? hours : {}
  return WEEKDAYS.map((day) => {
    const slot = source[day.iso]
    return {
      iso: day.iso,
      label: day.label,
      enabled: Boolean(slot?.open && slot?.close),
      open: slot?.open || (day.iso === '6' ? '09:30' : '08:30'),
      close: slot?.close || (day.iso === '6' ? '13:30' : '18:30'),
    }
  })
}

export function weekdaysToHours(days: WeekdayHours[]): BusinessHours {
  const next: BusinessHours = {}
  for (const day of days) {
    if (!day.enabled) continue
    next[day.iso] = { open: day.open, close: day.close }
  }
  return next
}
