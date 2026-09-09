import {
  UserPlus,
  Users,
  Landmark,
  CalendarDays,
  LayoutGrid,
  FileText,
  Layers,
  CircleDollarSign,
  BarChart3,
  Compass,
  Activity,
  ScanLine,
  type LucideIcon,
} from 'lucide-react'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type CrmModuleId = 'ventas' | 'contabilidad'

export interface CrmNavItem {
  label: string
  href: string
  icon: LucideIcon
}

export const crmModules: {
  id: CrmModuleId
  label: string
  href: string
  items: CrmNavItem[]
}[] = [
  {
    id: 'ventas',
    label: 'Ventas',
    href: '/inmobiliaria/leads',
    items: [
      { label: 'Inventario', href: '/inmobiliaria/inventario', icon: LayoutGrid },
      { label: 'Proyectos', href: '/inmobiliaria/proyectos', icon: Layers },
      { label: 'Leads', href: '/inmobiliaria/leads', icon: UserPlus },
      { label: 'Automatización', href: '/inmobiliaria/automatizacion', icon: Activity },
      { label: 'Showroom', href: '/inmobiliaria/showroom', icon: Landmark },
      { label: 'Recorrido 360°', href: '/inmobiliaria/recorrido', icon: Compass },
      { label: 'Análisis de planos', href: '/inmobiliaria/analisis-planos', icon: ScanLine },
      { label: 'Agenda', href: '/inmobiliaria/agenda', icon: CalendarDays },
      { label: 'Ventas', href: '/inmobiliaria/ventas', icon: BarChart3 },
      { label: 'Usuarios', href: '/inmobiliaria/usuarios', icon: Users },
    ],
  },
  {
    id: 'contabilidad',
    label: 'Contabilidad',
    href: '/inmobiliaria/financiamiento',
    items: [
      { label: 'Financiamiento', href: '/inmobiliaria/financiamiento', icon: CircleDollarSign },
      { label: 'Contratos', href: '/inmobiliaria/contratos', icon: FileText },
    ],
  },
]

export function moduleFromPath(pathname: string): CrmModuleId {
  const match = crmModules.find((module) =>
    module.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
  )
  return match?.id ?? 'ventas'
}

export function itemsForModule(
  moduleId: CrmModuleId,
  role?: UserRole | string | null,
  crmPaths?: string[] | null,
) {
  if (role == null && !(crmPaths && crmPaths.length > 0)) return []
  const items = crmModules.find((module) => module.id === moduleId)?.items ?? crmModules[0].items
  return items.filter((item) => canAccessPath(role, item.href, crmPaths))
}

export function modulesForRole(role?: UserRole | string | null, crmPaths?: string[] | null) {
  if (role == null && !(crmPaths && crmPaths.length > 0)) return []
  return crmModules.filter((module) =>
    module.items.some((item) => canAccessPath(role, item.href, crmPaths)),
  )
}
