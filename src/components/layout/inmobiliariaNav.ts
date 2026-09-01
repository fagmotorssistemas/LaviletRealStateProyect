import {
  UserPlus,
  Landmark,
  CalendarDays,
  LayoutGrid,
  FileText,
  Layers,
  CircleDollarSign,
  BarChart3,
  type LucideIcon,
} from 'lucide-react'

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
]

export function moduleFromPath(pathname: string): CrmModuleId {
  const match = crmModules.find((module) =>
    module.items.some((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
  )
  return match?.id ?? 'ventas'
}

export function itemsForModule(moduleId: CrmModuleId) {
  return crmModules.find((module) => module.id === moduleId)?.items ?? crmModules[0].items
}
