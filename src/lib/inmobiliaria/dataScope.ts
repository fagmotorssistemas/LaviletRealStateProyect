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
  return {
    userId,
    isAdmin: role === 'admin',
  }
}
