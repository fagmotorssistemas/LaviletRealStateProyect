/** Shared by extraction, normalization and the read-only workflow inspector. */
export const EXTRACTED_CONVERSATION_EVENTS = [
  'declared_unit_type', 'declared_purchase_purpose', 'asked_location_features', 'asked_delivery_date',
  'asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'nutrition_response',
] as const
export const CONVERSATION_EVENTS = ['first_response', ...EXTRACTED_CONVERSATION_EVENTS] as const
export type ConversationEvent = typeof CONVERSATION_EVENTS[number]
export const CONVERSATION_EVENT_DETAILS: Record<ConversationEvent, { title: string; description: string }> = {
  first_response: { title: 'Participación del lead', description: 'Señal normalizada de respuesta del lead; no demuestra una primera respuesta enviada por el bot.' },
  declared_unit_type: { title: 'Tipo de inmueble declarado', description: 'Preferencia declarada y respaldada por el mensaje actual; no elige una unidad concreta.' },
  declared_purchase_purpose: { title: 'Uso de compra declarado', description: 'Finalidad declarada por el lead; su residencia actual no demuestra el uso de la compra.' },
  asked_location_features: { title: 'Consulta de ubicación o características', description: 'Señal informativa del mensaje; no autoriza una visita ni una gestión.' },
  asked_delivery_date: { title: 'Consulta de entrega', description: 'Interés en el plazo del proyecto; no acredita una fecha disponible o confirmada.' },
  asked_price: { title: 'Consulta de precios', description: 'Interés en precios; no acredita presupuesto, aceptación del valor ni elección de unidad.' },
  asked_financing: { title: 'Consulta de financiamiento', description: 'Señal financiera aceptada por la ruta; la autorización para recopilar datos se comprueba por separado.' },
  requested_visit: { title: 'Solicitud de visita', description: 'Señal de visita aceptada por los controles; no acredita cita registrada, destino aceptado ni horario confirmado.' },
  asked_reservation: { title: 'Interés en reserva', description: 'Señal sobre reserva; no demuestra solicitud ejecutada, inventario reservado ni pago.' },
  nutrition_response: { title: 'Respuesta a seguimiento', description: 'Señal de interacción con el seguimiento; no autoriza por sí sola otra acción comercial.' },
}
