import { CURRENT_TONE } from './conversation-tone'
import { object, text } from './data'

type Opening = { family: string; prefix: string; phrase: string }
/** Legacy compatibility: code no longer interprets a writer's courtesy. */
export function replyOpening(_reply: string): Opening | null { void _reply;  return null }
export function recentReplyOpenings(history: unknown) {
  return (Array.isArray(history) ? history : []).map(object)
    .filter(row => ['bot', 'asesor'].includes(text(row.role))).slice(-6)
    .map(row => ({ text: text(row.content), opening: null as Opening | null }))
}
export function variedReplyOpening(reply: string, _history: unknown) { void _history;  return reply }
export function decidedOpening(_base: string, _history: unknown) { void _base; void _history;  return { prefix: '', removed_repetition: false } }
export function informationRequestOpening(reply: string) { return reply }
export function applyDecidedOpening(reply: string, _prefix: string, _history?: unknown) { void _prefix; void _history;  return reply }

/** Supply recent text as context; only the writer evaluates repetition. */
export function openingWritingRules(history: unknown) {
  const starts = recentReplyOpenings(history).map(row => row.text.split(/\s+/).slice(0, 9).join(' '))
  return '\n' + JSON.stringify(starts) + '\n' + CURRENT_TONE.openingInstructions + CURRENT_TONE.openingOptional
}
