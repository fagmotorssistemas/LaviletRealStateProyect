export type KommoFailureDetails = {
  failure_kind?: 'timeout' | 'network' | 'response_body' | 'invalid_response' | 'http' | 'admission'
  network_code?: string
  response_received?: boolean
  observed_http_status?: number
}
const networkCodes = /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_(?:CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET)|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)$/

/** Retain allowlisted transport diagnostics, never provider bodies, URLs,
 * credentials, arbitrary error messages or customer data. */
export function kommoConnectionFailure(error: unknown): KommoFailureDetails {
  const row = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; cause?: unknown } : {}
  const cause = row.cause && typeof row.cause === 'object' ? row.cause as { code?: unknown } : {}
  const code = typeof cause.code === 'string' ? cause.code : typeof row.code === 'string' ? row.code : ''
  const safeCode = networkCodes.test(code) ? code : undefined
  return { failure_kind: row.name === 'TimeoutError' || row.name === 'AbortError'
    || safeCode && /TIMEOUT|TIMEDOUT/.test(safeCode) ? 'timeout' : 'network',
    response_received: false, ...(safeCode ? { network_code: safeCode } : {}) }
}

export function recordedKommoFailure(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof Error) || !/^KOMMO_/.test(error.message)) return null
  const provider = error as Error & { status?: unknown; uncertain?: unknown; operation?: unknown; diagnostic?: KommoFailureDetails }
  if (typeof provider.status !== 'number' || typeof provider.uncertain !== 'boolean') return null
  const detail = provider.diagnostic || {}
  return { http_status: provider.status, delivery_uncertain: provider.uncertain,
    provider_operation: ['read', 'update_field', 'launch_bot'].includes(String(provider.operation)) ? provider.operation : 'unknown',
    ...(['timeout', 'network', 'response_body', 'invalid_response', 'http', 'admission'].includes(String(detail.failure_kind)) ? { failure_kind: detail.failure_kind } : {}),
    ...(networkCodes.test(String(detail.network_code)) ? { network_code: detail.network_code } : {}),
    ...(typeof detail.response_received === 'boolean' ? { response_received: detail.response_received } : {}),
    ...(typeof detail.observed_http_status === 'number' && Number.isInteger(detail.observed_http_status)
      && detail.observed_http_status >= 100 && detail.observed_http_status < 600 ? { observed_http_status: detail.observed_http_status } : {}) }
}

/** Explain legacy errors honestly; absence of an HTTP response does not prove
 * a timeout, an account outage, or that a write was never accepted. */
export function kommoFailureExplanation(code: string, details: Record<string, unknown> = {}): string | null {
  if (code === 'DELIVERY_RETRY_NO_LONGER_AUTHORIZED') return 'No se reenvió la respuesta preparada porque cambió el estado de la conversación, intervino un asesor o el bot ya no tiene permiso. Revise la conversación actual; los mensajes pendientes conservan su procesamiento normal.'
  if (code === 'DELIVERY_RETRY_CHECKPOINT_INVALID' || code === 'DELIVERY_RETRY_CHECKPOINT_REQUIRED') return 'No se inició el reintento porque falta una respuesta preparada válida y comprobada. El sistema no inventa ni reconstruye un envío histórico sin ese registro.'
  if (code === 'REPLY_WINDOW_EXPIRED') return 'No se envió la respuesta porque venció la ventana de 24 horas desde el mensaje original. Un reintento no abre una ventana nueva; revise la atención pendiente del lead.'
  if (code === 'TEST_CONTACTS_READ_FAILED') return 'Falló la consulta de la lista de contactos de prueba en la base de datos. Es un error de mantenimiento; este registro no demuestra un fallo de IA ni un envío a Kommo.'
  if (!/^KOMMO_(?:UNAVAILABLE|ADMISSION_FAILED|\d{3})$/.test(code)) return null
  const operation = details.provider_operation
  const task = operation === 'update_field' ? 'actualizar los campos del lead' : operation === 'read' ? 'consultar Kommo'
    : operation === 'launch_bot' ? 'iniciar Salesbot y solicitar el envío de la respuesta' : 'comunicarse con Kommo'
  const cause = details.failure_kind === 'timeout' ? 'La petición agotó el tiempo de espera'
    : details.failure_kind === 'response_body' ? 'Se recibió una respuesta HTTP, pero no se pudo leer su contenido'
      : details.failure_kind === 'invalid_response' ? 'Kommo devolvió un contenido que no se pudo interpretar'
        : details.failure_kind === 'admission' || code === 'KOMMO_ADMISSION_FAILED' ? 'El control local de solicitudes no permitió iniciar la petición'
          : code === 'KOMMO_UNAVAILABLE' ? 'Falló la conexión sin conservarse una respuesta HTTP válida'
            : `Kommo respondió con HTTP ${Number(code.slice(6))}`
  const diagnosis = details.network_code === 'ECONNRESET' || details.network_code === 'UND_ERR_SOCKET' ? ' La conexión se cerró inesperadamente.'
    : details.network_code === 'ENOTFOUND' || details.network_code === 'EAI_AGAIN' ? ' Falló la resolución del nombre del servidor.'
      : details.network_code === 'ECONNREFUSED' ? ' El servidor rechazó la conexión.' : ''
  const uncertain = details.delivery_uncertain === true || code === 'KOMMO_UNAVAILABLE' && operation !== 'read'
  return `${cause} al ${task}.${diagnosis} ${operation === 'read' ? 'La consulta no envía mensajes.'
    : uncertain ? 'No se confirmó si Kommo aceptó el intento. Revise el historial antes de reenviar para evitar duplicados. Los mensajes siguientes de este lead pueden quedar pendientes hasta comprobar el intento.'
      : 'El intento fue rechazado antes de confirmarse un envío.'} Esto no demuestra que la redacción de la IA fuera incorrecta.`
}
