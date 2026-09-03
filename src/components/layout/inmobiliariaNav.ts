import {
  UserPlus,
  Landmark,
  CalendarDays,
  LayoutGrid,
  Table2,
  FileText,
  Layers,
  CircleDollarSign,
  BarChart3,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { canAccessPath } from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

export type CrmModuleId = 'ventas' | 'contabilidad' | 'admin'

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
      { label: 'Inventario 2', href: '/inmobiliaria/inventario-2', icon: Table2 },
      { label: 'Proyectos', href: '/inmobiliaria/proyectos', icon: Layers },
      { label: 'Leads', href: '/inmobiliaria/leads', icon: UserPlus },
      { label: 'Showroom', href: '/inmobiliaria/showroom', icon: Landmark },
      { label: 'Agenda', href: '/inmobiliaria/agenda', icon: CalendarDays },
      { label: 'Ventas', href: '/inmobiliaria/ventas', icon: BarChart3 },
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
  {
    id: 'admin',
    label: 'Admin',
    href: '/inmobiliaria/usuarios',
    items: [{ label: 'Usuarios', href: '/inmobiliaria/usuarios', icon: Users }],
  },
]

export function moduleFromPath(pathname: string): CrmModuleId {
  const match = crmModules.find((module) =>
    module.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
  )
  return match?.id ?? 'ventas'
}

export function itemsForModule(moduleId: CrmModuleId, role?: UserRole | string | null) {
  if (role == null) return []
  const items = crmModules.find((module) => module.id === moduleId)?.items ?? crmModules[0].items
  return items.filter((item) => canAccessPath(role, item.href))
}

export function modulesForRole(role?: UserRole | string | null) {
  if (role == null) return []
  return crmModules.filter((module) => module.items.some((item) => canAccessPath(role, item.href)))
}
