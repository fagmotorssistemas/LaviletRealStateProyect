'use client'

import { useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { BOT_STATUS_OPTIONS, HANDOFF_STATUS_OPTIONS, LEAD_STAGE_OPTIONS, SLA_STATUS_OPTIONS, sourceLabel } from '@/lib/inmobiliaria/leadAutomation'
import { LEAD_TEMPERATURE_OPTIONS, UNASSIGNED_ASSIGNEE, type Project, type TeamProfile } from '@/types/inmobiliaria'
import type { LeadAutomationFilters } from '@/types/leadAutomation'
import styles from './AutomationWorkspace.module.css'

interface Props {
  filters: LeadAutomationFilters; projects: Project[]; advisors: TeamProfile[]; sources: string[]; hasFilters: boolean
  updateFilter: (key: keyof LeadAutomationFilters, value: string) => void
  updateFilters: (patch: Partial<LeadAutomationFilters>) => void
  resetFilters: () => void
}

export function AutomationFilters({ filters, projects, advisors, sources, hasFilters, updateFilter, updateFilters, resetFilters }: Props) {
  const [expanded, setExpanded] = useState(false)
  const additional = [filters.from, filters.to, filters.source, filters.temperature, filters.assignedTo, filters.handoff, filters.bot, filters.sla].filter(Boolean).length
  const clearView = { temperature: '', assignedTo: '', bot: '', sla: '', handoff: '' }
  const views = [
    { label: 'Todos', active: !Object.keys(clearView).some(key => filters[key as keyof LeadAutomationFilters]), patch: {} },
    { label: 'Tibios y calientes', active: filters.temperature === 'tibio_caliente', patch: { temperature: 'tibio_caliente' } },
    { label: 'Sin asignar', active: filters.assignedTo === UNASSIGNED_ASSIGNEE, patch: { assignedTo: UNASSIGNED_ASSIGNEE } },
    { label: 'Bot activo', active: filters.bot === 'activo', patch: { bot: 'activo' } },
    { label: 'Respuesta vencida', active: filters.sla === 'vencido', patch: { sla: 'vencido' } },
  ]
  return <section className={styles.filters} aria-label="Filtros de leads">
    <div className={styles.filterRow}>
      <div className={styles.search}><Search size={14} /><input aria-label="Buscar leads" placeholder="Buscar nombre, teléfono o Kommo ID…" value={filters.search} onChange={event => updateFilter('search', event.target.value)} /></div>
      <Select aria-label="Filtrar por proyecto" placeholder="Todos los proyectos" options={projects.map(project => ({ value: project.id, label: project.name }))} value={filters.projectId} onChange={event => updateFilter('projectId', event.target.value)} />
      <Select aria-label="Filtrar por etapa" placeholder="Todas las etapas" options={LEAD_STAGE_OPTIONS} value={filters.stage} onChange={event => updateFilter('stage', event.target.value)} />
      <button type="button" className={styles.action} aria-expanded={expanded} aria-controls="automation-advanced-filters" onClick={() => setExpanded(!expanded)}><SlidersHorizontal size={13} />Filtros{additional ? ` (${additional})` : ''}</button>
    </div>
    <div className={styles.filterViews}><span>Vistas</span>{views.map(view => <button type="button" key={view.label} className={styles.quickView} aria-pressed={view.active} onClick={() => updateFilters({ ...clearView, ...view.patch })}>{view.label}</button>)}
      {hasFilters && <button type="button" onClick={resetFilters} className={`${styles.quickView} ml-auto`}><X size={11} />Limpiar filtros</button>}
    </div>
    {expanded && <div id="automation-advanced-filters" className={styles.advanced}>
      <Input id="automation-from" label="Desde" type="date" value={filters.from} onChange={event => updateFilter('from', event.target.value)} />
      <Input id="automation-to" label="Hasta" type="date" value={filters.to} onChange={event => updateFilter('to', event.target.value)} />
      <Select label="Origen" placeholder="Todos" options={sources.map(source => ({ value: source, label: sourceLabel(source) }))} value={filters.source} onChange={event => updateFilter('source', event.target.value)} />
      <Select label="Temperatura" placeholder="Todas" options={[...LEAD_TEMPERATURE_OPTIONS, { value: 'tibio_caliente', label: 'Tibios y calientes' }]} value={filters.temperature} onChange={event => updateFilter('temperature', event.target.value)} />
      <Select label="Responsable" placeholder="Todos" options={[{ value: UNASSIGNED_ASSIGNEE, label: 'Sin asignar' }, ...advisors.map(advisor => ({ value: advisor.id, label: advisor.full_name || 'Sin nombre' }))]} value={filters.assignedTo} onChange={event => updateFilter('assignedTo', event.target.value)} />
      <Select label="Traspaso" placeholder="Todos" options={HANDOFF_STATUS_OPTIONS} value={filters.handoff} onChange={event => updateFilter('handoff', event.target.value)} />
      <Select label="Bot" placeholder="Todos" options={BOT_STATUS_OPTIONS} value={filters.bot} onChange={event => updateFilter('bot', event.target.value)} />
      <Select label="Plazo de respuesta" placeholder="Todos" options={SLA_STATUS_OPTIONS} value={filters.sla} onChange={event => updateFilter('sla', event.target.value)} />
    </div>}
  </section>
}
