import { object, text } from './data'
import { normalized } from './sdr-rules'

/** Interpret a correction from context without merging events or changing their evidence boundaries. */
export function showroomRequest(current: string, history: unknown = []) {
  const m = normalized(current)
  if (/\bno (?:quiero|necesito|deseo|me interesa)\b/.test(m)) return null
  const asksHow = (s: string) => /\b(?:como|donde) (?:puedo|podemos|se puede|podria) (?:ver|conocer)\b/.test(normalized(s))
    && /\b(?:departamentos?|penthouses?|suites?|edificios?|proyecto|viviendas?|verlos|verlas)\b/.test(normalized(s))
  if (asksHow(current)) return { kind: 'visual_request', current, context: '' }
  const correction = /^(?:(?:los?|las?|el) )?(?:departamentos?|penthouses?|suites?|viviendas?)(?: (?:perdon|perdone|disculpe|quise decir))$/.test(m)
    || /^(?:perdon|perdone|disculpe|quise decir) (?:(?:los?|las?|el) )?(?:departamentos?|penthouses?|suites?|viviendas?)$/.test(m)
  if (!correction) return null
  const previous = (Array.isArray(history) ? history : []).map(object).filter(row => text(row.content).trim() !== current.trim()).at(-1)
  return previous && ['cliente', 'user'].includes(text(previous.role)) && asksHow(text(previous.content))
    ? { kind: 'visual_correction', current, context: text(previous.content) } : null
}

export function asksConstructionStatus(current: string) {
  return /\b(?:terminad[oa]s?|construid[oa]s?|construccion|avance de obra|departamento modelo)\b/.test(normalized(current))
    && !/\bno (?:quiero|necesito|deseo|me interesa)\b/.test(normalized(current))
}
