import { object, text, type Row } from './data'

export const REFERENTIAL_PRICE_NOTICE = 'Estos son los precios referenciales vigentes y pueden cambiar.'

/** Notice visibility never changes the commercial nature or disclosure permission of a price. */
export function referentialPriceNoticeRequired(policyInput: unknown): boolean {
  const policy = object(policyInput)
  return policy.precios_aproximados === true && policy.aviso_precios_referenciales !== false && policy.precios_autorizados !== false
}

export const REFERENTIAL_PRICE_NOTICE_RULES = `AVISO AUTOMÁTICO DE PRECIOS: price_notice_frequency=once_per_conversation indica que el aviso rutinario se comunica una sola vez. price_notice_previously_shared=true acredita que ya apareció en una respuesta registrada del bot: no lo repita al dar otro precio, cambiar de unidad o explicar presupuesto. Su omisión posterior no cambia la naturaleza aproximada del precio. si politica_comercial.precios_aproximados=true y aviso_precios_referenciales no es false, al comunicar precios conserve su carácter referencial vigente y posibilidad de cambio con cualquier formulación equivalente. No exija mencionar lanzamiento ni otra etapa para cumplir el aviso. La etapa por sí sola no decide ese aviso; no la añada por costumbre. Si aviso_precios_referenciales=false, no añada automáticamente la aclaración «son referenciales y pueden cambiar» ni una equivalente. Ese ajuste solo controla el aviso rutinario: no cambia los precios, su naturaleza aproximada, sus permisos de publicación ni las condiciones comerciales verificadas. Si el cliente pregunta expresamente por vigencia, cambios o condiciones, responda esa consulta con los hechos y políticas disponibles; nunca deduzca que el precio es fijo o está garantizado por tener el aviso desactivado.`
/** A stored delivery receipt owns notice continuity; prose is never rescanned. */
export function priceNoticeForConversation(verified: Row, history: unknown): Row {
  const policy = object(verified.politica_comercial)
  const saved = object(verified.price_notice_receipt)
  const savedReceipt = saved.version === 'price-notice-v1' && saved.shared === true
    && saved.source === 'accepted_bot_reply' && Boolean(text(saved.source_message_id))
  void history
  return { ...policy, price_notice_frequency: 'once_per_conversation',
    price_notice_previously_shared: savedReceipt,
    ...(savedReceipt ? { aviso_precios_referenciales: false, price_notice_receipt: saved } : {}) }

}

/** Persisted only with the accepted reply's summary, never on preparation. */
export function priceNoticeReceipt(reply: string, verified: Row, sourceMessageId: string, audit: Row = {}): Row | null {
  void reply
  void verified
  const review = object(audit.turn_completeness)
  const receipt = object(review.writer_receipts || audit.writer_receipts)
  return sourceMessageId.trim() && receipt.price_notice_included === true
    ? { version: 'price-notice-v1', shared: true, source: 'accepted_bot_reply', source_message_id: sourceMessageId } : null
}

/** Compatibility passthrough. Only the writer and AI reviewer assess the notice. */
export function ensureReferentialPriceConditions(reply: string, verified: Row, audit: Row = {}): { reply: string; applied: boolean } {
  void verified
  void audit
  return { reply, applied: false }
}
