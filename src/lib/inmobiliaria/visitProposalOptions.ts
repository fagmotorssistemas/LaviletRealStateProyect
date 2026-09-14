import type { VisitTimeSlot } from '@/types/inmobiliaria'
import { formatVisitWhen } from './visitClock'

export const MAX_VISIT_OPTIONS = 3

export function normalizeVisitOptions(value: unknown, now = Date.now()): VisitTimeSlot[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_VISIT_OPTIONS) {
    throw new Error('Elija entre uno y tres horarios para la propuesta.')
  }
  const result = value.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('Revise los horarios seleccionados.')
    const start = Date.parse(String(raw.start_time ?? '')), end = Date.parse(String(raw.end_time ?? ''))
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 3_600_000 || start <= now) {
      throw new Error('Cada opción debe ser futura y durar 60 minutos.')
    }
    return { start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() }
  })
  if (new Set(result.map(slot => slot.start_time)).size !== result.length) {
    throw new Error('Hay horarios repetidos. Cambie o quite una de las opciones.')
  }
  return result
}

// Dates and links are rendered from trusted data, never written by the language model.
export function visitOptionsList(slots: VisitTimeSlot[]): string {
  return slots.map((slot, index) => `${index + 1}. ${formatVisitWhen(slot.start_time).replace(/^el /, '')}`).join('\n')
}

export type VisitProposalPreview = {
  requestId: string
  options: VisitTimeSlot[]
  message: string
  requestVersion: string
  token: string
}
