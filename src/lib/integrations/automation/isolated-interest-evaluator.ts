import type { Row } from './data'

export type IsolatedSourceMessage = {
  externalId: string
  sentAt: string
  role: 'cliente'
  content: string
}

type ScopeDecision = {
  kind: 'property' | 'out_of_scope' | 'mixed' | 'neutral'
  property_message: string
  uncertain: boolean
}

type Interpretation = {
  method: 'model' | 'literal_greeting' | 'unreadable_input'
  extracted: Row
  promptRevision: string | null
}

export type IsolatedEvaluationResult = {
  externalId: string
  sourceSentAt: string
  evaluated: boolean
  events: string[]
  scope: ScopeDecision['kind']
  method: Interpretation['method'] | 'scope_rejected'
  promptRevision: string | null
}

type Dependencies = {
  classifyScope: (current: string, history: Row[], introduced: boolean) => Promise<ScopeDecision>
  interpret: (input: Row) => Promise<Interpretation>
  evaluate: (externalId: string, events: string[]) => Promise<void>
}

const eventList = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.filter((event): event is string => typeof event === 'string' && event.trim().length > 0))]
  : []

/**
 * Reutiliza los dos productores actuales y limita el único efecto permitido a
 * lv_evaluate_message_interest. No genera respuestas ni invoca el procesador de conversación.
 */
export async function evaluateStoredCustomerMessages(
  messages: IsolatedSourceMessage[],
  dependencies: Dependencies,
  initialHistory: Row[] = [],
): Promise<IsolatedEvaluationResult[]> {
  const ordered = [...messages].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
  const seen = new Set<string>()
  const history: Row[] = initialHistory.map(row => ({ ...row }))
  const results: IsolatedEvaluationResult[] = []

  for (const message of ordered) {
    if (!message.externalId.trim() || seen.has(message.externalId)) throw new Error('ISOLATED_MESSAGE_ID_INVALID')
    if (!message.content.trim() || !Number.isFinite(Date.parse(message.sentAt))) throw new Error('ISOLATED_MESSAGE_EVIDENCE_INVALID')
    seen.add(message.externalId)

    const scope = await dependencies.classifyScope(message.content, history, true)
    if (scope.uncertain || scope.kind === 'out_of_scope') {
      results.push({ externalId: message.externalId, sourceSentAt: message.sentAt, evaluated: false,
        events: [], scope: scope.kind, method: 'scope_rejected', promptRevision: null })
      history.push({ role: 'cliente', content: message.content, sent_at: message.sentAt })
      continue
    }

    const actionMessage = scope.kind === 'mixed' ? scope.property_message : message.content
    const interpretation = await dependencies.interpret({
      resumen: {}, historial: history, historial_reciente: history.slice(-8),
      tema_actual: 'property', alcance_negocio: scope.kind,
      ultima_pregunta: '', pregunta_pendiente: {}, contexto_propiedades: {},
      catalogo_unidades: [], propuestas: [], coordinacion_visita: null,
      financiamiento: {}, unidades_identificadas: [],
      mensaje_actual: message.content, mensaje_accion: actionMessage,
    })
    const events = eventList(interpretation.extracted.events)
    if (interpretation.method === 'model') {
      await dependencies.evaluate(message.externalId, events)
    }
    results.push({ externalId: message.externalId, sourceSentAt: message.sentAt,
      evaluated: interpretation.method === 'model', events, scope: scope.kind,
      method: interpretation.method, promptRevision: interpretation.promptRevision })
    history.push({ role: 'cliente', content: message.content, sent_at: message.sentAt })
  }
  return results
}
