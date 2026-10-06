/** Human explanation only; callers keep the original code in the audit. */
export function reservationServiceError(code: unknown): string | null {
  if (typeof code !== 'string' || !/^RPC[ _]LV[ _]REQUEST[ _]RESERVATION[ _]HANDOFF[ _](?:PGRST202|42883)$/i.test(code.trim())) return null
  return 'La función de solicitudes de reserva no está disponible en la API. Revise la instalación de la migración de reservas y la caché del esquema. Este intento no acredita una solicitud registrada ni un asesor asignado.'
}
