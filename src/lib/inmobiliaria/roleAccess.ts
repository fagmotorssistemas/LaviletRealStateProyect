import type { UserRole } from '@/types/inmobiliaria'

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'visitante', label: 'Visitante' },
  { value: 'asesor', label: 'Asesor' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'contable', label: 'Contable' },
  { value: 'admin', label: 'Administrador' },
]

const ROLE_SET = new Set<string>(USER_ROLE_OPTIONS.map((item) => item.value))

export function knownRole(role: string | null | undefined): UserRole | null {
  const value = String(role ?? '').trim().toLowerCase()
  if (value === 'administrador') return 'admin'
  if (ROLE_SET.has(value)) return value as UserRole
  return null
}

export function normalizeRole(role: string | null | undefined): UserRole {
  return knownRole(role) ?? 'visitante'
}

export function roleLabel(role: string | null | undefined): string {
  const normalized = normalizeRole(role)
  return USER_ROLE_OPTIONS.find((item) => item.value === normalized)?.label ?? normalized
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) === 'admin'
}

/** Visitante solo consulta. Rol desconocido no se trata como visitante. */
export function canWriteCrm(role: string | null | undefined): boolean {
  return knownRole(role) !== 'visitante'
}

export function canManageUsers(role: string | null | undefined): boolean {
  return isAdminRole(role)
}

const ROLE_PATHS: Record<UserRole, readonly string[]> = {
  visitante: [],
  marketing: ['/inmobiliaria/inventario', '/inmobiliaria/inventario-2', '/inmobiliaria/proyectos'],
  asesor: [
    '/inmobiliaria/inventario',
    '/inmobiliaria/inventario-2',
    '/inmobiliaria/proyectos',
    '/inmobiliaria/leads',
    '/inmobiliaria/showroom',
    '/inmobiliaria/agenda',
    '/inmobiliaria/ventas',
  ],
  contable: ['/inmobiliaria/financiamiento', '/inmobiliaria/contratos'],
  admin: [
    '/inmobiliaria/inventario',
    '/inmobiliaria/inventario-2',
    '/inmobiliaria/proyectos',
    '/inmobiliaria/leads',
    '/inmobiliaria/showroom',
    '/inmobiliaria/agenda',
    '/inmobiliaria/ventas',
    '/inmobiliaria/financiamiento',
    '/inmobiliaria/contratos',
    '/inmobiliaria/usuarios',
  ],
}

export function allowedPathsForRole(role: string | null | undefined): readonly string[] {
  const roleName = knownRole(role)
  if (!roleName) return []
  return ROLE_PATHS[roleName]
}

export function canAccessPath(role: string | null | undefined, pathname: string): boolean {
  if (!pathname.startsWith('/inmobiliaria')) return true
  const roleName = knownRole(role)
  if (!roleName) return true
  return ROLE_PATHS[roleName].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  )
}

export function homePathForRole(role: string | null | undefined): string {
  const roleName = knownRole(role)
  if (roleName === 'visitante') return '/cuenta'
  if (roleName === 'contable') return '/inmobiliaria/financiamiento'
  return '/inmobiliaria/inventario'
}
