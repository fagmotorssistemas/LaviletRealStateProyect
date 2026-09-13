'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Building2, DollarSign, MessageSquareText, RefreshCw, Search, Save } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects } from '@/services/inmobiliaria.service'
import { loadUnitPricesAction, saveUnitPriceAction } from '@/app/inmobiliaria/automatizacion/precios/actions'
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
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('todos')
  const [category, setCategory] = useState('viviendas')
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
        if (active) { setProjects(rows); setProjectId(rows[0]?.id || ''); if (!rows.length) setLoading(false) }
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
      setDrafts(Object.fromEntries(data.units.map(unit => [unit.id, unit.published_commercial_price == null ? '' : String(unit.published_commercial_price)])))
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los precios') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, revision])

  const changed = (unit: UnitPriceRow) => {
    try { return parseCommercialPrice(drafts[unit.id] ?? '') !== unit.published_commercial_price }
    catch { return true }
  }
  const dirty = units.some(changed)
  const changeProject = (value: string) => {
    if (dirty) { toast.error('Guarde los precios pendientes o pulse Descartar cambios antes de cambiar de proyecto.'); return }
    setProjectId(value)
  }
  const discard = () => setDrafts(Object.fromEntries(units.map(unit => [unit.id, unit.published_commercial_price == null ? '' : String(unit.published_commercial_price)])))
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
  const scoped = units.filter(unit => category === 'todos' || ['departamento', 'suite'].includes(normalizeUnitCategory(unit.category) || unit.category))
  const visible = scoped.filter(unit => unit.unit_number.toLowerCase().includes(search.trim().toLowerCase())
    && (filter === 'todos' || (filter === 'sin_precio' ? !unit.published_commercial_price : !!unit.published_commercial_price)))
  const label = (unit: UnitPriceRow) => ({ departamento: 'Departamento', suite: 'Suite', local: 'Local' }[normalizeUnitCategory(unit.category) || unit.category] || unit.category)

  return <div className={styles.shell}>
    <AutomationSettingsHeader active="precios" title="Precios por departamento" description="Mantenga un precio comercial por unidad, compartido con el inventario y la conversación del bot."
      project={<Select label="Proyecto" value={projectId} disabled={!!saving || loading} options={projects.map(project => ({ value: project.id, label: project.name }))} onChange={event => changeProject(event.target.value)} />} />
    {loading ? <div className="flex justify-center py-20"><Spinner /></div> : error ? <div className={styles.notice} role="alert"><strong>No se pudieron cargar los precios</strong><p>{error}</p><Button variant="outline" onClick={() => projectId ? setRevision(value => value + 1) : setProjectRevision(value => value + 1)}>Reintentar</Button></div> : !projectId ? <p>No hay proyectos disponibles.</p> : <>
      <AutomationSettingsSummary items={[
        { label: 'Unidades', value: scoped.length, detail: category === 'viviendas' ? 'Departamentos y suites del proyecto' : 'Todas las unidades del proyecto', icon: Building2 },
        { label: 'Con precio guardado', value: scoped.filter(unit => unit.published_commercial_price).length, detail: 'Precio comercial en dólares estadounidenses', icon: DollarSign },
        { label: 'Precios en el bot', value: mode === 'preventa' ? 'Habilitados' : 'En espera', detail: mode === 'preventa' ? 'Solo unidades publicadas y disponibles' : 'El proyecto está en modo lanzamiento', icon: MessageSquareText },
      ]} />
      <div className={styles.notice}>
        <strong>{mode === 'preventa' ? 'El bot puede informar los precios guardados' : 'Puede cargar los precios antes de anunciarlos'}</strong>
        <p>{mode === 'preventa' ? 'Al guardar, el bot podrá usar el precio de una unidad publicada y disponible en las siguientes consultas.' : 'En modo lanzamiento el bot no informa precios. Para anunciarlos debe cambiar el modo a Preventa en Reglas y SLA; guardar un precio aquí no cambia ese modo.'} <Link href="/inmobiliaria/automatizacion/reglas" className="underline underline-offset-4">Ver reglas</Link></p>
        <p>Ingrese el precio total de venta de cada unidad en USD. Este dato es el mismo del inventario; no modifica el costo por m². Deje el campo vacío y guarde para retirar el precio comercial.</p>
      </div>
      <section className={styles.panel} aria-label="Edición de precios comerciales">
        <div className={priceStyles.toolbar}>
          <div className={priceStyles.search}><Search size={16} /><Input id="price-search" aria-label="Buscar número de unidad" placeholder="Buscar departamento, ej. 210" value={search} onChange={event => setSearch(event.target.value)} /></div>
          <Select aria-label="Tipo de unidad" value={category} options={[{ value: 'viviendas', label: 'Departamentos y suites' }, { value: 'todos', label: 'Todas las unidades' }]} onChange={event => setCategory(event.target.value)} />
          <Select aria-label="Filtrar precios" value={filter} options={[{ value: 'todos', label: 'Todos los precios' }, { value: 'sin_precio', label: 'Sin precio' }, { value: 'con_precio', label: 'Con precio' }]} onChange={event => setFilter(event.target.value)} />
          <Button variant="outline" disabled={!!saving || dirty} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /> Actualizar</Button>
        </div>
        <div className={priceStyles.caption}><span>{visible.length} unidades · Ejemplos: 200000 o 200.000,50 USD</span>{dirty && <><strong>Hay cambios sin guardar</strong><Button size="sm" variant="outline" disabled={!!saving} onClick={discard}>Descartar cambios</Button></>}</div>
        <div className={`${styles.panelBody} ${priceStyles.tableWrap}`}>
          <table className={priceStyles.table}>
            <thead><tr><th>Unidad</th><th>Características</th><th>Precio guardado</th><th>Nuevo precio · USD</th><th>Uso en el bot</th><th><span className="sr-only">Guardar</span></th></tr></thead>
            <tbody>{visible.map(unit => <tr key={unit.id}>
              <td><strong>{unit.unit_number}</strong><small>{label(unit)}</small></td>
              <td>{unit.bedrooms ? `${unit.bedrooms} dormitorios` : '—'}<small>{unit.area_internal_m2 ? `${unit.area_internal_m2.toLocaleString('es-EC')} m² interiores` : 'Área sin registrar'}</small></td>
              <td>{unit.published_commercial_price == null ? <span className="text-[#92998a]">Sin precio</span> : formatCurrency(unit.published_commercial_price)}</td>
              <td><Input aria-label={`Precio comercial de ${unit.unit_number} en USD`} inputMode="decimal" maxLength={24} placeholder="Sin precio" value={drafts[unit.id] ?? ''} disabled={!!saving} onChange={event => setDrafts(current => ({ ...current, [unit.id]: event.target.value }))} /></td>
              <td><span className={styles.statusBadge}>{botPriceStatus(unit, mode)}</span></td>
              <td><Button size="sm" disabled={!!saving || !changed(unit)} onClick={() => void save(unit)} aria-label={`Guardar precio de ${unit.unit_number}`}><Save size={14} />{saving === unit.id ? 'Guardando…' : 'Guardar'}</Button></td>
            </tr>)}</tbody>
          </table>
          {!visible.length && <p className="py-8 text-center text-sm text-[#7b8576]">No hay unidades que coincidan con estos filtros.</p>}
        </div>
      </section>
    </>}
  </div>
}
