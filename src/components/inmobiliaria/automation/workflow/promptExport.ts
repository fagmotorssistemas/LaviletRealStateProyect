import { aiRequestBody } from '@/lib/integrations/automation/ai-request-body'
import type { WorkflowExecutionStep } from './executionWorkflow'

const row = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export function promptExport(step: WorkflowExecutionStep) {
  if (!step.input.prompt_snapshot) return null
  const snapshot = row(step.input.prompt_snapshot), parameters = row(snapshot.request_parameters)
  const reasons = [
    ...(snapshot.capture_version !== 2 ? ['Registro antiguo: no garantiza conservar el texto exacto.'] : []),
    ...(snapshot.limited === true ? ['Parte del contenido está abreviada.'] : []),
    ...(snapshot.privacy_filtered === true ? ['Algunos datos están protegidos.'] : []),
    ...(step.input.attachments_omitted === true ? ['Los archivos o imágenes adjuntos no se conservaron.'] : []),
  ]
  const model = parameters.model || step.input.model
  const maxTokens = parameters.max_output_tokens ?? step.input.configured_max_output_tokens
  const missing = typeof snapshot.instructions !== 'string' || typeof snapshot.user_prefix !== 'string' || typeof model !== 'string'
  if (missing) reasons.push('Faltan partes de la solicitud original.')
  const body = aiRequestBody({ model: typeof model === 'string' ? model : '', instructions: String(snapshot.instructions || ''),
    input: snapshot.data, userPrefix: String(snapshot.user_prefix || ''),
    schema: snapshot.response_schema ? row(snapshot.response_schema) : undefined,
    maxOutputTokens: typeof maxTokens === 'number' ? maxTokens : undefined,
    reasoningEffort: String(parameters.reasoning_effort || step.input.reasoning_effort || '') || undefined })
  return {
    partial: missing || snapshot.limited === true || step.input.attachments_omitted === true || snapshot.capture_version !== 2,
    exact: reasons.length === 0,
    notice: reasons.length ? reasons.join(' ') : 'Solicitud textual completa de esta llamada.',
    text: JSON.stringify({ capture: { step: step.order, agent: step.input.ai_role || step.input.task || 'No registrado',
      exact: reasons.length === 0, limitations: reasons }, request: body }, null, 2),
  }
}
