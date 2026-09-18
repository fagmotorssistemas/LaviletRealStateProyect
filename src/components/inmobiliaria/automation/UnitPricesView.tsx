'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Building2, DollarSign, MessageSquareText, RefreshCw, Search, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { listProjects } from '@/services/inmobiliaria.service'
import { loadUnitPricesAction, saveUnitPriceAction, saveLaunchPriceVisibilityAction } from '@/app/inmobiliaria/automatizacion/precios/actions'
import { botPriceStatus, parseCommercialPrice, type UnitPriceRow } from '@/lib/inmobiliaria/unitPrices'
import { normalizeUnitCategory, type Project } from '@/types/inmobiliaria'
import { formatCurrency } from '@/lib/utils'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { AutomationSettingsHeader, AutomationSettingsSummary, automationSettingsStyles as styles } from './AutomationSettings'
import priceStyles from './UnitPricesView.module.css'

export function UnitPricesView() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [units, setUnits] = useState<UnitPriceRow[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [mode, setMode] = useState('lanzamiento')
  const [launchVisible, setLaunchVisible] = useState(false)
  const [savedLaunchVisible, setSavedLaunchVisible] = useState(false)
  const [projectUpdatedAt, setProjectUpdatedAt] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('todos')
  const [category, setCategory] = useState('todos')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')
  const [revision, setRevision] = useState(0)
  const [projectRevision, setProjectRevision] = useState(0)
  useEffect(() => {
    if (authLoading || !user) return
    let active = true
    setLoading(true); setError('')
    void (async () => {
      try {
        const ids = await getAccessibleTenantIds(supabase)
        const rows = ids.length ? await listProjects(supabase, ids[0], ids) : []
        if (active) {
          setProjects(rows)
          setProjectId(current => rows.some(project => project.id === current) ? current : rows.find(project => project.id === LAVILET_PROJECT_ID)?.id || rows[0]?.id || '')
          if (!rows.length) setLoading(false)
        }
      } catch { if (active) { setError('No se pudieron cargar los proyectos'); setLoading(false) } }
    })()
    return () => { active = false }
  }, [authLoading, user, supabase, projectRevision])
  useEffect(() => {
    if (!projectId) return
    let active = true
    setLoading(true); setError('')
    void loadUnitPricesAction(projectId).then(data => {
      if (!active) return
      setUnits(data.units); setMode(data.mode)
      setLaunchVisible(data.launchVisible); setSavedLaunchVisible(data.launchVisible); setProjectUpdatedAt(data.projectUpdatedAt)
      setDrafts(Object.fromEntries(data.units.map(unit => [unit.id, unit.published_commercial_price == null ? '' : String(unit.published_commercial_price)])))
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los precios') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, revision])

  const changed = (unit: UnitPriceRow) => {
    try { return parseCommercialPrice(drafts[unit.id] ?? '') !== unit.published_commercial_price }
    catch { return true }
  }
  const visibilityDirty = launchVisible !== savedLaunchVisible
  const dirty = units.some(changed) || visibilityDirty
  const changeProject = (value: string) => {
    if (dirty) { toast.error('Guarde los cambios pendientes o pulse Descartar cambios antes de cambiar de proyecto.'); return }
    setProjectId(value)
  }
  const discard = () => {
    setDrafts(Object.fromEntries(units.map(unit => [unit.id, unit.published_commercial_price == null ? '' : String(unit.published_commercial_price)])))
    setLaunchVisible(savedLaunchVisible)
  }
  const saveVisibility = async () => {
    setSaving('visibility')
    try {
      const updated = await saveLaunchPriceVisibilityAction({ projectId, visible: launchVisible, expectedUpdatedAt: projectUpdatedAt })
      setLaunchVisible(updated.launchVisible); setSavedLaunchVisible(updated.launchVisible); setProjectUpdatedAt(updated.projectUpdatedAt)
      toast.success('Visibilidad de precios guardada')
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar la visibilidad') }
    finally { setSaving('') }
  }
  const save = async (unit: UnitPriceRow) => {
    const price = drafts[unit.id] ?? ''
    try { parseCommercialPrice(price) } catch (cause) { toast.error((cause as Error).message); return }
    setSaving(unit.id)
    try {
      const updated = await saveUnitPriceAction({ projectId, unitId: unit.id, price, expectedUpdatedAt: unit.updated_at })
      setUnits(current => current.map(row => row.id === updated.id ? updated : row))
      setDrafts(current => ({ ...current, [unit.id]: updated.published_commercial_price == null ? '' : String(updated.published_commercial_price) }))
      toast.success(updated.published_commercial_price == null ? `Precio retirado de ${unit.unit_number}` : `Precio de ${unit.unit_number} guardado`)
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar el precio') }
    finally { setSaving('') }
  }
  const scoped = units.filter(unit => category === 'todos' || (category === 'viviendas'
    ? ['departamento', 'suite', 'penthouse'].includes(normalizeUnitCategory(unit.category) || unit.category)
    : normalizeUnitCategory(unit.category) === category))
  const visible = scoped.filter(unit => unit.unit_number.toLowerCase().includes(search.trim().toLowerCase())
    && (filter === 'todos' || (filter === 'sin_precio' ? !unit.published_commercial_price : !!unit.published_commercial_price)))
  const label = (unit: UnitPriceRow) =>
    ({ departamento: 'Departamento', suite: 'Suite', penthouse: 'Penthouse', local: 'Local' }[
      normalizeUnitCategory(unit.category) || unit.category
    ] || unit.category)

  return <div className={styles.shell}>
    <AutomationSettingsHeader active="precios" title="Precios por unidad" description="Administre los precios de departamentos, suites, penthouses y locales comerciales, compartidos con el inventario y el bot."
      project={<Select label="Proyecto" value={projectId} disabled={!!saving || loading} options={projects.map(project => ({ value: project.id, label: project.name }))} onChange={event => changeProject(event.target.value)} />} />
    {loading ? <div className="flex justify-center py-20"><Spinner /></div> : error ? <div className={styles.notice} role="alert"><strong>No se pudieron cargar los precios</strong><p>{error}</p><Button variant="outline" onClick={() => projectId ? setRevision(value => value + 1) : setProjectRevision(value => value + 1)}>Reintentar</Button></div> : !projectId ? <p>No hay proyectos disponibles.</p> : <>
      <AutomationSettingsSummary items={[
        { label: 'Unidades', value: scoped.length, detail: category === 'viviendas' ? 'Departamentos, suites y penthouses del proyecto' : category === 'local' ? 'Locales comerciales del proyecto' : 'Todas las unidades del proyecto', icon: Building2 },
        { label: 'Con precio guardado', value: scoped.filter(unit => unit.published_commercial_price).length, detail: 'Precio comercial en dólares estadounidenses', icon: DollarSign },
        { label: 'Precios en el bot', value: mode === 'preventa' ? 'Habilitados' : savedLaunchVisible ? 'Aproximados' : 'Ocultos', detail: mode === 'preventa' ? 'Solo unidades publicadas y disponibles' : 'El proyecto está en modo lanzamiento', icon: MessageSquareText },
      ]} />
      <div className={styles.notice}>
        <strong>{mode === 'preventa' ? 'El bot puede informar los precios guardados' : 'Decida si anuncia precios durante Lanzamiento'}</strong>
        <p>{mode === 'preventa' ? 'El bot informa el precio guardado sin la aclaración de lanzamiento. Solo usa unidades publicadas y disponibles.' : 'Si habilita la visibilidad, el bot presenta los precios guardados como aproximados y aclara que pueden cambiar durante Lanzamiento. Si la desactiva, no informa esos valores.'} <Link href="/inmobiliaria/automatizacion/reglas" className="underline underline-offset-4">Ver reglas</Link></p>
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <label className="flex items-center gap-3 font-medium" htmlFor="launch-price-visibility">
            <input id="launch-price-visibility" type="checkbox" className="h-5 w-5 accent-[#34412d]" checked={launchVisible} disabled={!!saving} aria-describedby="launch-price-help" onChange={event => setLaunchVisible(event.target.checked)} />
            Mostrar precios aproximados en Lanzamiento
          </label>
          <Button size="sm" disabled={!!saving || !visibilityDirty} onClick={() => void saveVisibility()}><Save size={14} />{saving === 'visibility' ? 'Guardando…' : 'Guardar visibilidad'}</Button>
        </div>
        <p id="launch-price-help">Este ajuste solo se aplica durante Lanzamiento y no cambia la fase del proyecto.{visibilityDirty ? ' La visibilidad tiene cambios sin guardar.' : ''}</p>
        <p>Ingrese el precio total de venta de cada unidad en USD. Este dato es el mismo del inventario; no modifica el costo por m². Deje el campo vacío y guarde para retirar el precio comercial.</p>
      </div>
      <section className={styles.panel} aria-label="Edición de precios comerciales">
        <div className={priceStyles.toolbar}>
          <div className={priceStyles.search}><Search size={16} /><Input id="price-search" aria-label="Buscar número de unidad" placeholder="Buscar unidad, ej. 210 o LC-05" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <Select aria-label="Tipo de unidad" value={category} options={[{ value: 'todos', label: 'Todas las unidades' }, { value: 'viviendas', label: 'Departamentos, suites y penthouses' }, { value: 'local', label: `Locales comerciales (${units.filter(unit => normalizeUnitCategory(unit.category) === 'local').length})` }]} onChange={event => setCategory(event.target.value)} />
          <Select aria-label="Filtrar precios" value={filter} options={[{ value: 'todos', label: 'Todos los precios' }, { value: 'sin_precio', label: 'Sin precio' }, { value: 'con_precio', label: 'Con precio' }]} onChange={event => setFilter(event.target.value)} />
          <Button variant="outline" disabled={!!saving || dirty} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> Actualizar</Button>
        </div>
        <div className={priceStyles.caption}><span>{visible.length} unidades · Ejemplos: 200000 o 200.000,50 USD</span>{dirty && <><strong>Hay cambios sin guardar</strong><Button size="sm" variant="outline" disabled={!!saving} onClick={discard}>Descartar cambios</Button></>}</div>
        <div className={`${styles.panelBody} ${priceStyles.tableWrap}`}>
          <table className={priceStyles.table}>
            <thead><tr><th>Unidad</th><th>Características</th><th>Precio guardado</th><th>Nuevo precio · USD</th><th>Uso en el bot</th><th><span className="sr-only">Guardar</span></th></tr></thead>
            <tbody>{visible.map(unit => <tr key={unit.id}>
              <td><strong>{unit.unit_number}</strong><small>{label(unit)}</small></td>
              <td>{unit.bedrooms ? `${unit.bedrooms} dormitorios` : '—'}<small>{unit.floor_number === 0 ? 'Planta baja' : unit.floor_number != null ? `Piso ${unit.floor_number}` : 'Piso sin registrar'}</small><small>{unit.area_internal_m2 ? `${unit.area_internal_m2.toLocaleString('es-EC')} m² interiores` : 'Área sin registrar'}</small></td>
              <td>{unit.published_commercial_price == null ? <span className="text-[#92998a]">Sin precio</span> : formatCurrency(unit.published_commercial_price)}</td>
              <td><Input aria-label={`Precio comercial de ${unit.unit_number} en USD`} inputMode="decimal" maxLength={24} placeholder="Sin precio" value={drafts[unit.id] ?? ''} disabled={!!saving} onChange={event => setDrafts(current => ({ ...current, [unit.id]: event.target.value }))} /></td>
              <td><span className={styles.statusBadge}>{botPriceStatus(unit, mode, savedLaunchVisible)}</span></td>
              <td><Button size="sm" disabled={!!saving || !changed(unit)} onClick={() => void save(unit)} aria-label={`Guardar precio de ${unit.unit_number}`}><Save size={14} />{saving === unit.id ? 'Guardando…' : 'Guardar'}</Button></td>
            </tr>)}</tbody>
          </table>
          {!visible.length && <p className="py-8 text-center text-sm text-[#7b8576]">No hay unidades que coincidan con estos filtros.</p>}
        </div>
      </section>
    </>}
  </div>
}
