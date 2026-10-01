'use client'

import { useState } from 'react'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { MessageTraceView } from './MessageTraceView'
import { ArchitectureMap } from './ArchitectureMap'
import styles from './AutomationWorkflowView.module.css'

export function AutomationWorkflowView() {
  const { isAdmin } = useRoleAccess()
  const [view, setView] = useState<'messages' | 'architecture'>('architecture')
  return <main className={styles.workspace}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}><strong>Automatización</strong><span>/</span>Mapa operativo</p>
        <h1 className={styles.title}>Mensajes y decisiones</h1>
        <p className={styles.description}>Explore las decisiones del sistema, los agentes y el recorrido registrado de cada mensaje.</p></div>
      <div className={styles.headerActions}><AutomationSectionTabs active="workflow" /><span className={styles.readOnly}>Solo lectura</span></div>
    </header>
    <nav className={styles.viewTabs} aria-label="Vista de automatización">
      <button type="button" aria-pressed={view === 'architecture' || !isAdmin} onClick={() => setView('architecture')}>Mapa de arquitectura</button>
      {isAdmin && <button type="button" aria-pressed={view === 'messages'} onClick={() => setView('messages')}>Por mensaje</button>}
    </nav>
    {isAdmin ? <MessageTraceView architecture={view === 'architecture'} /> : <ArchitectureMap />}
  </main>
}
