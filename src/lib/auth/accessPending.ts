/** Cuenta creada por /register y aún sin vistas CRM asignadas por un admin. */
export function isAccessPending(meta: {
  app_metadata?: Record<string, unknown> | null
  user_metadata?: Record<string, unknown> | null
} | null | undefined): boolean {
  if (!meta) return false
  return meta.app_metadata?.access_pending === true || meta.user_metadata?.access_pending === true
}

export const ACCESS_PENDING_PATH = '/acceso-pendiente'
