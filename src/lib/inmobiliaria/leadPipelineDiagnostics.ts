import type { LeadPipelineIssue } from '@/types/leadPipeline'

/** Only sanitized codes and categories cross the server boundary. Database
 * messages can contain SQL, customer data or infrastructure details. */
export function pipelineIssue(source: string, label: string, error: unknown, reference: string): LeadPipelineIssue {
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = typeof row.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(row.code) ? row.code : null
  const status = Number(row.status)
  const category: LeadPipelineIssue['category'] =
    ['42P01', '42703', '42883', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code || '') ? 'schema'
    : ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code || '') || [401, 403].includes(status) ? 'permission'
    : code === 'SERVER_CONFIGURATION_MISSING' ? 'configuration'
    : ['57014', '53300', '08000', '08001', '08006', 'PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'].includes(code || '')
      || status === 429 || status >= 500 || row.name === 'TypeError' || row.name === 'AbortError' || row.name === 'TimeoutError'
      || typeof row.message === 'string' && /fetch failed|failed to fetch|network|timeout|timed out/i.test(row.message) ? 'temporary' : 'unknown'
  const messages = {
    schema: 'La estructura necesaria no está disponible. Revise las migraciones y la actualización del esquema.',
    permission: 'No se pudo consultar con su acceso actual. Revise los permisos de esta sección.',
    temporary: 'La consulta falló temporalmente. Vuelva a intentar.',
    configuration: 'La consulta requiere configuración del servidor. Contacte con administración.',
    unknown: 'No se pudo completar la consulta. Revise la referencia del diagnóstico.',
  }
  return { source, label, category, code, reference, message: messages[category] }
}

export function coverageIncomplete(coverage: Record<string, boolean>): boolean {
  return Object.values(coverage).some(value => value === false)
}
