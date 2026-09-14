// Identificadores verificados contra los workflows y la cuenta de La Vilet.
// No aplicar este mapeo a otros proyectos o cuentas de Kommo.
export const LAVILET_PROJECT_ID = 'b1b2c3d4-0001-4000-8000-000000000001'
export const LAVILET_TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
export const LAVILET_KOMMO_ORIGIN = 'https://lavilet.kommo.com'
export const LAVILET_MESSAGE_ROUTES = [
  { kind: 'conversation', botId: 15578, fieldId: 457014 },
  // Free-form messages are sent only inside the verified 24-hour window. The
  // textarea keeps complete proposals and maps; legacy text fields capped 256.
  { kind: 'visit_propose', botId: 15578, fieldId: 457014 },
  { kind: 'visit_confirm', botId: 15578, fieldId: 457014 },
  { kind: 'visit_reschedule_confirm', botId: 15578, fieldId: 457014 },
  { kind: 'visit_2h', botId: 15578, fieldId: 457014 },
] as const
