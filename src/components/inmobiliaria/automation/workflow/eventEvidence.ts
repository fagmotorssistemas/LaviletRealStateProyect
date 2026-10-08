import { CONVERSATION_EVENTS, type ConversationEvent } from '@/lib/integrations/automation/event-contract'
import type { WorkflowExecutionStep } from './executionWorkflow'
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const eventList = (value: unknown) => Array.isArray(value) ? value.filter((event): event is ConversationEvent =>
  typeof event === 'string' && CONVERSATION_EVENTS.includes(event as ConversationEvent)) : null

/** Only the successful semantic receipt contains events accepted by the route.
 * Raw model output is kept separately; it must never highlight a chosen event. */
export function acceptedEventSteps(event: ConversationEvent, steps: WorkflowExecutionStep[]) {
  return steps.filter(step => step.key === 'semantic_extraction' && step.status === 'succeeded'
    && eventList(step.output.events)?.includes(event))
}
export function candidateEventSteps(event: ConversationEvent, steps: WorkflowExecutionStep[]) {
  return steps.filter(step => step.key === 'model_request' && step.input.ai_role === 'extractor'
    && eventList(record(record(step.output.output_snapshot).data).events)?.includes(event)
    && !steps.some(parent => parent.key === 'semantic_extraction' && parent.status === 'succeeded'
      && parent.order === step.input.caused_by_step && eventList(parent.output.events) !== null))
}
export function eventSelectionState(event: ConversationEvent, steps: WorkflowExecutionStep[]) {
  if (acceptedEventSteps(event, steps).length) return 'observed'
  if (candidateEventSteps(event, steps).length) return 'candidate'
  return steps.some(step => step.key === 'semantic_extraction' && step.status === 'succeeded'
    && eventList(step.output.events) !== null) ? 'not_detected' : 'unknown'
}
