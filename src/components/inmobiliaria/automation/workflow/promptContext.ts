export type ContextKind = 'history' | 'memory' | 'current' | 'other'
export type PromptPart = { text: string; kind: ContextKind }

const historyKeys = new Set(['historial', 'historial_reciente', 'history', 'recent_history'])
const memoryKeys = new Set(['lead', 'resumen', 'memoria_comercial', '_commercial_memory', '_sales_memory',
  'property_context', 'contexto_propiedades', '_property_context', 'pregunta_pendiente', 'ultima_pregunta',
  'ultima_respuesta', 'conversacion', 'referencia_unidad', 'continuidad_residencial', 'pista_de_continuidad'])
const currentKeys = new Set(['mensaje_actual', 'mensaje_accion', 'current_message'])
const kindFor = (key: string, inherited: ContextKind): ContextKind => historyKeys.has(key) ? 'history'
  : currentKeys.has(key) ? 'current' : memoryKeys.has(key) ? 'memory' : inherited

/** Color only recorded fields, including nested ones; never infer missing history.
 * Joining parts reproduces JSON.stringify(data, null, 2) exactly. */
export function promptContextParts(data: unknown): PromptPart[] {
  const parts: PromptPart[] = []
  const emit = (text: string, kind: ContextKind) => { parts.push({ text, kind }) }
  const visit = (value: unknown, depth: number, kind: ContextKind) => {
    if (value === null || typeof value !== 'object') { emit(JSON.stringify(value) ?? 'null', kind); return }
    const array = Array.isArray(value)
    const entries = array ? value.map((v, i) => [String(i), v] as const) : Object.entries(value).filter(([, v]) => v !== undefined)
    emit(array ? '[' : '{', kind)
    entries.forEach(([key, child], index) => {
      const next = array ? kind : kindFor(key, kind)
      emit('\n' + '  '.repeat(depth + 1) + (array ? '' : JSON.stringify(key) + ': '), next)
      visit(child, depth + 1, next)
      if (index < entries.length - 1) emit(',', next)
    })
    emit((entries.length ? '\n' + '  '.repeat(depth) : '') + (array ? ']' : '}'), kind)
  }
  visit(data, 0, 'other')
  return parts
}
