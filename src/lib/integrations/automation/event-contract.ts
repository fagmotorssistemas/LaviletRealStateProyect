/** Shared by extraction, normalization and the read-only workflow inspector. */
export const EXTRACTED_CONVERSATION_EVENTS = [
  'declared_unit_type', 'declared_purchase_purpose', 'asked_location_features', 'asked_delivery_date',
  'asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'nutrition_response',
] as const
export const CONVERSATION_EVENTS = ['first_response', ...EXTRACTED_CONVERSATION_EVENTS] as const
export type ConversationEvent = typeof CONVERSATION_EVENTS[number]
export const CONVERSATION_EVENT_DETAILS: Record<ConversationEvent, { title: string; description: string }> = {
  first_response: { title: 'Participación del lead', description: 'El lead participó en la conversación. Esta señal corresponde al cliente, no a una respuesta del bot.' },
  declared_unit_type: { title: 'Tipo de inmueble declarado', description: 'El lead indicó qué tipo de inmueble le interesa. La elección de una unidad se registra por separado.' },
  declared_purchase_purpose: { title: 'Uso de compra declarado', description: 'El lead explicó para qué necesita el inmueble.' },
  asked_location_features: { title: 'Consulta de ubicación o características', description: 'El lead pidió información sobre la ubicación o las características del proyecto.' },
  asked_delivery_date: { title: 'Consulta de entrega', description: 'El lead preguntó por los plazos de entrega del proyecto.' },
  asked_price: { title: 'Consulta de precios', description: 'El lead consultó un precio. Esta consulta no define su presupuesto ni elige una unidad.' },
  asked_financing: { title: 'Consulta de financiamiento', description: 'El lead consultó sobre financiamiento. La autorización para iniciar una revisión se comprueba por separado.' },
  requested_visit: { title: 'Solicitud de visita', description: 'El lead solicitó una visita. Su horario y confirmación se comprueban en la gestión de la cita.' },
  asked_reservation: { title: 'Interés en reserva', description: 'El lead mostró interés en reservar. La solicitud efectiva, el pago y la disponibilidad se comprueban por separado.' },
  nutrition_response: { title: 'Respuesta a seguimiento', description: 'El lead respondió a un mensaje de seguimiento.' },
}
