import type { UserRole } from '@/types/inmobiliaria'

export const USER_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: 'visitante', label: 'Visitante' },
  { value: 'asesor', label: 'Asesor' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'contable', label: 'Contable' },
  { value: 'admin', label: 'Administrador' },
]

/** Vistas del CRM que el admin puede asignar a un perfil. */
export const CRM_VIEW_OPTIONS: { href: string; label: string; group: 'ventas' | 'contabilidad' | 'admin' }[] = [
  { href: '/inmobiliaria/inventario', label: 'Inventario', group: 'ventas' },
  { href: '/inmobiliaria/proyectos', label: 'Proyectos', group: 'ventas' },
  { href: '/inmobiliaria/leads', label: 'Leads', group: 'ventas' },
  { href: '/inmobiliaria/showroom', label: 'Showroom', group: 'ventas' },
  { href: '/inmobiliaria/recorrido', label: 'Recorrido 360°', group: 'ventas' },
  { href: '/inmobiliaria/agenda', label: 'Agenda', group: 'ventas' },
  { href: '/inmobiliaria/ventas', label: 'Ventas', group: 'ventas' },
  { href: '/inmobiliaria/financiamiento', label: 'Financiamiento', group: 'contabilidad' },
  { href: '/inmobiliaria/contratos', label: 'Contratos', group: 'contabilidad' },
  { href: '/inmobiliaria/usuarios', label: 'Usuarios', group: 'admin' },
]

const CRM_VIEW_HREF_SET = new Set(CRM_VIEW_OPTIONS.map((item) => item.href))

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

/** Solo roles de staff conocidos pueden escribir en el CRM. Rol nulo/desconocido = denegado. */
export function canWriteCrm(role: string | null | undefined): boolean {
  const roleName = knownRole(role)
  return roleName != null && roleName !== 'visitante'
}

export function canManageUsers(role: string | null | undefined): boolean {
  return isAdminRole(role)
}

const ROLE_PATHS: Record<UserRole, readonly string[]> = {
  visitante: [],
  marketing: ['/inmobiliaria/inventario', '/inmobiliaria/proyectos'],
  asesor: [
    '/inmobiliaria/inventario',
    '/inmobiliaria/proyectos',
    '/inmobiliaria/leads',
    '/inmobiliaria/automatizacion',
    '/inmobiliaria/showroom',
    '/inmobiliaria/recorrido',
    '/inmobiliaria/agenda',
    '/inmobiliaria/ventas',
  ],
  contable: ['/inmobiliaria/financiamiento', '/inmobiliaria/contratos'],
  admin: [
    '/inmobiliaria/inventario',
    '/inmobiliaria/proyectos',
    '/inmobiliaria/leads',
    '/inmobiliaria/automatizacion',
    '/inmobiliaria/showroom',
    '/inmobiliaria/recorrido',
    '/inmobiliaria/agenda',
    '/inmobiliaria/ventas',
    '/inmobiliaria/financiamiento',
    '/inmobiliaria/contratos',
    '/inmobiliaria/usuarios',
  ],
}

export function normalizeCrmPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return []
  const unique = new Set<string>()
  for (const item of paths) {
    const href = String(item ?? '').trim()
    if (CRM_VIEW_HREF_SET.has(href)) unique.add(href)
  }
  return CRM_VIEW_OPTIONS.map((item) => item.href).filter((href) => unique.has(href))
}

export function pathsForRole(role: string | null | undefined): string[] {
  const roleName = knownRole(role)
  if (!roleName) return []
  return [...ROLE_PATHS[roleName]]
}

/** Infiere un rol base a partir de las vistas elegidas (para escritura / admin). */
export function roleFromCrmPaths(paths: string[]): UserRole {
  const set = new Set(normalizeCrmPaths(paths))
  if (set.size === 0) return 'asesor'
  if (set.has('/inmobiliaria/usuarios')) return 'admin'

  const ventas = CRM_VIEW_OPTIONS.filter((item) => item.group === 'ventas').some((item) => set.has(item.href))
  const contabilidad = CRM_VIEW_OPTIONS.filter((item) => item.group === 'contabilidad').some((item) =>
    set.has(item.href),
  )
  const marketingOnly =
    !contabilidad &&
    [...set].every((href) => href === '/inmobiliaria/inventario' || href === '/inmobiliaria/proyectos')

  if (ventas && contabilidad) return 'admin'
  if (contabilidad && !ventas) return 'contable'
  if (marketingOnly) return 'marketing'
  return 'asesor'
}

export function allowedPathsForRole(role: string | null | undefined): readonly string[] {
  return pathsForRole(role)
}

export function effectiveCrmPaths(
  role: string | null | undefined,
  customPaths?: string[] | null,
): string[] {
  const custom = normalizeCrmPaths(customPaths)
  if (custom.length > 0) return custom
  return pathsForRole(role)
}

export function canAccessPath(
  role: string | null | undefined,
  pathname: string,
  customPaths?: string[] | null,
): boolean {
  if (!pathname.startsWith('/inmobiliaria')) return true
  const paths = effectiveCrmPaths(role, customPaths)
  if (paths.length === 0) return false
  return paths.some((href) => pathname === href || pathname.startsWith(`${href}/`))
}

export function homePathForRole(
  role: string | null | undefined,
  customPaths?: string[] | null,
): string {
  const paths = effectiveCrmPaths(role, customPaths)
  if (paths.length === 0) return '/cuenta'
  return paths[0]
}
