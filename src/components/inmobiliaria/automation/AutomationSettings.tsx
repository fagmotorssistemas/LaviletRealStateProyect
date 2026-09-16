'use client'

import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { ArrowUpRight, BellRing, ChevronRight, type LucideIcon } from 'lucide-react'
import { useVisitInboxContext } from '@/contexts/VisitInboxContext'
import { AutomationSectionTabs } from './AutomationSectionTabs'
import workspace from './AutomationWorkspace.module.css'
import styles from './AutomationSettings.module.css'

export { styles as automationSettingsStyles }

export function AutomationSettingsHeader({ active, title, description, project }: {
  active: 'reglas' | 'guion' | 'ubicacion' | 'precios' | 'estilo'; title: string; description: string; project: ReactNode
}) {
  const inbox = useVisitInboxContext()
  return <>
    <header className={workspace.header}>
      <div>
        <p className={workspace.eyebrow}><strong>Automatización</strong><span>/</span>Control comercial</p>
        <h1 className={workspace.title}>{title}</h1>
        <p className={workspace.description}>{description}</p>
      </div>
      <div className={workspace.headerActions}>
        <AutomationSectionTabs active={active} />
        <button type="button" className={`${workspace.action} ${inbox.pending.length ? workspace.primary : ''}`} title={inbox.error || (!inbox.ready ? 'Cargando citas pendientes' : 'Abrir la bandeja de citas pendientes')} onClick={() => inbox.openInbox('pending')}>
          <BellRing size={15} /> Citas por atender <span className={styles.counter}>{inbox.error ? '!' : !inbox.ready ? '…' : inbox.pending.length}</span><ArrowUpRight size={14} />
        </button>
      </div>
    </header>
    <div className={styles.projectBar}><div>{project}</div><p>Revise la configuración del proyecto.<br /><span>Guarde cada sección cuando termine de editarla.</span></p></div>
  </>
}

export function AutomationSettingsSummary({ items }: { items: { label: string; value: ReactNode; detail: string; icon: LucideIcon; muted?: boolean }[] }) {
  return <div className={styles.summary}>{items.map(({ label, value, detail, icon: Icon, muted }) =>
    <div className={styles.metric} key={label} data-muted={muted || undefined}>
      <div className={styles.metricLabel}>{label}<Icon size={17} /></div>
      <div className={styles.metricValue}>{value}</div><p>{detail}</p>
    </div>)}</div>
}

type Section = { id: string; label: string; detail: string; icon: LucideIcon }
const SectionsContext = createContext<{ active: string; prefix: string } | null>(null)

export function AutomationSettingsSections({ sections, initial, selected, onSelect, children }: { sections: Section[]; initial?: string; selected?: string; onSelect?: (id: string) => void; children: ReactNode }) {
  const [localActive, setLocalActive] = useState(initial || sections[0].id)
  const active = selected ?? localActive
  const setActive = (id: string) => { setLocalActive(id); onSelect?.(id) }
  const prefix = useId()
  return <SectionsContext.Provider value={{ active, prefix }}>
    <div className={styles.settingsGrid}>
      <aside className={styles.sidebar}>
        <p className={styles.navLabel}>En esta sección</p>
        <div role="tablist" aria-label="Ajustes de automatización" className={styles.sectionNav} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const index = sections.findIndex(s => s.id === active)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : (index + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + sections.length) % sections.length
          setActive(sections[next].id)
          document.getElementById(`${prefix}-tab-${sections[next].id}`)?.focus()
        }}>
          {sections.map(({ id, label, detail, icon: Icon }) => <button key={id} type="button" role="tab" id={`${prefix}-tab-${id}`} aria-controls={`${prefix}-panel-${id}`} aria-selected={active === id} tabIndex={active === id ? 0 : -1} onClick={() => setActive(id)}>
            <Icon size={18} /><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight size={14} />
          </button>)}
        </div>
        <p className={styles.navHelp}>Puede cambiar de sección sin perder lo que está editando.</p>
      </aside>
      <div className={styles.panelArea}>{children}</div>
    </div>
  </SectionsContext.Provider>
}

export function AutomationSettingsPanel({ id, title, description, action, children }: { id: string; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  const context = useContext(SectionsContext)
  if (!context) throw Error('AutomationSettingsPanel requires AutomationSettingsSections')
  return <section role="tabpanel" id={`${context.prefix}-panel-${id}`} aria-labelledby={`${context.prefix}-tab-${id}`} hidden={context.active !== id} className={styles.panel} tabIndex={0}>
    <div className={styles.panelHeader}><div><h2>{title}</h2><p>{description}</p></div>{action && <div className={styles.panelAction}>{action}</div>}</div>
    <div className={styles.panelBody}>{children}</div>
  </section>
}
