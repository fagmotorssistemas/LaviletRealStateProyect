'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import styles from './AutomationWorkspace.module.css'

export function AutomationSectionTabs({ active, attentionCount }: { active: 'monitoreo' | 'control' | 'workflow' | 'reglas' | 'guion' | 'ubicacion' | 'precios' | 'estilo' | 'proyecto' | 'pruebas' | 'conocimiento'; attentionCount?: number }) {
  const { isAdmin } = useRoleAccess()
  const [remoteAttentionCount, setRemoteAttentionCount] = useState<number | null>(null)
  useEffect(() => {
    if (attentionCount != null) return
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/inmobiliaria/automation/attention', { cache: 'no-store' })
        const body = await response.json() as { count?: number }
        if (!cancelled && response.ok && Number.isFinite(body.count)) setRemoteAttentionCount(Number(body.count))
      } catch { /* El acceso a las demás secciones no depende del contador. */ }
    }
    void load()
    const timer = window.setInterval(() => void load(), 30_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [attentionCount])
  const visibleAttentionCount = attentionCount ?? remoteAttentionCount
  const tabs = [
    { id: 'monitoreo', href: '/inmobiliaria/automatizacion', label: `Monitoreo${visibleAttentionCount == null ? '' : ` (${visibleAttentionCount})`}` },
    { id: 'control', href: '/inmobiliaria/automatizacion/control', label: 'Control de leads' },
    { id: 'workflow', href: '/inmobiliaria/automatizacion/workflow', label: 'Flujo visual' },
    ...(isAdmin ? [
      { id: 'pruebas', href: '/inmobiliaria/automatizacion/pruebas', label: 'Pruebas y revisión' },
      { id: 'conocimiento', href: '/inmobiliaria/automatizacion/conocimiento', label: 'Conocimiento y reglas' },
    ] : []),
  ]
  return <nav className={styles.tabs} aria-label="Secciones de automatización">
    {tabs.map(tab => <Link key={tab.id} href={tab.href} aria-current={(active === tab.id || tab.id === 'conocimiento' && !['monitoreo', 'control', 'workflow', 'pruebas'].includes(active)) ? 'page' : undefined}>{tab.label}</Link>)}
  </nav>
}
