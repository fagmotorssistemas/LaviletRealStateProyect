/**
 * Gate de envío ViewContent: no marcar "ya enviado" hasta superar esperas
 * cancelables (p. ej. _fbp). Si se cancela al cerrar la ficha, reabrir puede
 * reintentar con el mismo event_id (dedupe Meta / outbox).
 */

export function shouldSkipViewContent(
  firedVisitKey: string | null,
  visitKey: string,
): boolean {
  return Boolean(visitKey) && firedVisitKey === visitKey
}

/**
 * Confirma el envío solo si no fue cancelado y aún no se marcó esta visita.
 * Devuelve true ⇒ el caller debe disparar CAPI enqueue (Pixel puede ir antes).
 */
export function claimViewContentSend(
  firedVisitKey: { current: string | null },
  visitKey: string,
  cancelled: boolean,
): boolean {
  if (!visitKey || cancelled) return false
  if (firedVisitKey.current === visitKey) return false
  firedVisitKey.current = visitKey
  return true
}
