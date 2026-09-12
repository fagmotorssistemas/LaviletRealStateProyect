'use client'

import Link from 'next/link'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import styles from './AutomationWorkspace.module.css'

export function AutomationSectionTabs({ active }: { active: 'monitoreo' | 'reglas' | 'guion' | 'ubicacion' }) {
  const { isAdmin } = useRoleAccess()
  const tabs = [
    { id: 'monitoreo', href: '/inmobiliaria/automatizacion', label: 'Monitoreo' },
    ...(isAdmin ? [
      { id: 'reglas', href: '/inmobiliaria/automatizacion/reglas', label: 'Reglas y SLA' },
      { id: 'guion', href: '/inmobiliaria/automatizacion/guion', label: 'Guion del bot' },
      { id: 'ubicacion', href: '/inmobiliaria/automatizacion/ubicacion', label: 'Ubicación' },
    ] : []),
  ]
  return <nav className={styles.tabs} aria-label="Secciones de automatización">
    {tabs.map(tab => <Link key={tab.id} href={tab.href} aria-current={active === tab.id ? 'page' : undefined}>{tab.label}</Link>)}
  </nav>
}
