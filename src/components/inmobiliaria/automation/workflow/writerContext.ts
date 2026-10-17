import type { WorkflowExecutionStep } from './executionWorkflow'

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const pick = (value: JsonObject, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))

/** Slices of the captured request, with original paths and values. Never
 * reconstruct a historical plan using today's code or current CRM data. */
export function writerContextSlices(step: WorkflowExecutionStep) {
  if (step.key !== 'model_request' || step.input.ai_role !== 'writer' && step.input.task !== 'writing') return null
  const snapshot = object(step.input.prompt_snapshot)
  if (!snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) return null
  const data = object(snapshot.data), verified = object(data.contexto_verificado), operational = object(data.estado_operativo)
  return {
    decision: { ...pick(data, ['contrato_redaccion', 'objetivo_comercial', 'obligaciones_del_turno', 'response_content_scope']),
      ...(Object.hasOwn(verified, 'siguiente_paso_comercial') ? { contexto_verificado: pick(verified, ['siguiente_paso_comercial']) } : {}) },
    profile: { ...(Object.keys(pick(verified, ['lead', 'perfil_lead', 'ficha_comercial', 'memoria_comercial', 'estado_conversacion'])).length
      ? { contexto_verificado: pick(verified, ['lead', 'perfil_lead', 'ficha_comercial', 'memoria_comercial', 'estado_conversacion']) } : {}),
      ...(Object.hasOwn(operational, 'profile_introduction') ? { estado_operativo: pick(operational, ['profile_introduction']) } : {}) },
    input: data,
    limited: snapshot.limited === true,
    protected: snapshot.privacy_filtered === true,
  }
}

/** The actual nested object, including an explicit null; no historical replay. */
export function recordedWriterObjective(step: WorkflowExecutionStep) {
  const capture = writerContextSlices(step)
  if (!capture) return null
  const contract = object(capture.input.contrato_redaccion)
  return Object.hasOwn(contract, 'objetivo_siguiente')
    ? { value: contract.objetivo_siguiente, limited: capture.limited, protected: capture.protected } : null
}
