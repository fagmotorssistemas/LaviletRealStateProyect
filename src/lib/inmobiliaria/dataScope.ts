import type { UserRole } from '@/types/inmobiliaria'

/** Alcance de datos según sesión: solo admin ve registros de todos los usuarios. */
export type DataAccessScope = {
  isAdmin: boolean
  userId: string
}

/**
 * A partir del rol en `profiles`, determina si el usuario actúa como administrador.
 * Roles distintos de `admin` se tratan como restringidos (mismo criterio que asesor) hasta definir reglas propias.
 */
export function getDataAccessScope(
  userId: string | undefined,
  role: UserRole | string | null | undefined,
): DataAccessScope | null {
  if (!userId) return null
  const normalized = String(role ?? '').trim().toLowerCase()
  return {
    userId,
    isAdmin: normalized === 'admin' || normalized === 'administrador',
  }
}

/** Admin ve todo. El resto ve lo asignado a sí mismo y lo que aún no tiene dueño. */
export function canAccessAssignedRecord(
  scope: DataAccessScope | null | undefined,
  assignedTo: string | null | undefined,
): boolean {
  if (!scope || scope.isAdmin) return true
  if (!assignedTo) return true
  return assignedTo === scope.userId
}
