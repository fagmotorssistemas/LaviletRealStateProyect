'use client'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { MapPin, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { googleMapsUrl, type ProjectVisitLocation } from '@/lib/inmobiliaria/projectLocation'
import { listProjects } from '@/services/inmobiliaria.service'
import { loadProjectLocationAction, saveProjectLocationAction } from '@/app/inmobiliaria/automatizacion/ubicacion/actions'
import { AutomationSectionTabs } from './AutomationSectionTabs'
import { PageHeader } from '../shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import type { Project } from '@/types/inmobiliaria'

const ProjectLocationMap = dynamic(() => import('./ProjectLocationMap'), { ssr: false, loading: () => <div className="flex h-[420px] items-center justify-center"><Spinner /></div> })

export function ProjectLocationView() {
  const { supabase, user, isLoading: authLoading } = useAuth()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [point, setPoint] = useState<ProjectVisitLocation | null>(null)
  const [savedUrl, setSavedUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (authLoading || roleLoading || !user || !isAdmin) return
    let active = true
    void (async () => {
      try {
        const ids = await getAccessibleTenantIds(supabase)
        const rows = ids.length ? await listProjects(supabase, ids[0], ids) : []
        if (active) { setProjects(rows); setProjectId(rows[0]?.id ?? ''); if (!rows.length) setLoading(false) }
      } catch { if (active) { setError('No se pudieron cargar los proyectos'); setLoading(false) } }
    })()
    return () => { active = false }
  }, [authLoading, roleLoading, user, isAdmin, supabase])
  useEffect(() => {
    if (!projectId || !isAdmin) return
    let active = true
    setLoading(true); setError(''); setPoint(null); setSavedUrl(null)
    void loadProjectLocationAction(projectId).then(data => {
      if (active) { setPoint(data.point); setSavedUrl(data.url) }
    }).catch(() => { if (active) setError('No se pudo cargar la ubicación del proyecto') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, isAdmin])
  const save = async () => {
    if (!point || !projectId) return
    setSaving(true)
    try {
      const data = await saveProjectLocationAction(projectId, point)
      setPoint(data.point); setSavedUrl(data.url)
      toast.success('Ubicación guardada. Se utilizará en las próximas confirmaciones de visita.')
    } catch (cause) { toast.error(cause instanceof Error ? cause.message : 'No se pudo guardar') }
    finally { setSaving(false) }
  }
  if (authLoading || roleLoading) return <Spinner />
  if (!isAdmin) return <p>La ubicación del proyecto la administra coordinación.</p>
  const selected = projects.find(project => project.id === projectId)
  const url = point ? googleMapsUrl(point) : null
  return <div className="crm-page space-y-6">
    <PageHeader eyebrow="AUTOMATIZACIÓN" title="Ubicación del proyecto" description="El punto de encuentro que compartiremos al confirmar una visita." />
    <AutomationSectionTabs active="ubicacion" />
    <div className="max-w-md"><Select label="Proyecto" value={projectId} disabled={saving} options={projects.map(p => ({ value: p.id, label: p.name }))} onChange={event => setProjectId(event.target.value)} /></div>
    {loading ? <div className="flex justify-center py-20"><Spinner /></div> : error ? <p role="alert" className="text-sm text-red-700">{error}</p> : !projectId ? <p>No hay proyectos disponibles.</p> : <section className="grid gap-6 rounded-2xl border border-[#e3e6dc] bg-white p-4 sm:p-6 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-3">
        <ProjectLocationMap key={projectId} point={point} onChange={value => { if (!saving) setPoint(value) }} />
        <p className="text-xs text-[#7b8170]">Haga clic en el mapa o arrastre el marcador hasta la entrada del proyecto.</p>
      </div>
      <div className="space-y-5">
        <div><MapPin size={22} className="mb-3 text-[#787d62]" /><h2 className="text-xl font-semibold text-[#3e4735]">{selected?.name}</h2><p className="mt-1 text-sm text-[#7b8170]">{selected?.address || 'Seleccione el punto de encuentro'}</p></div>
        <div className="rounded-xl bg-[#f6f8f1] p-4"><p className="text-xs font-semibold text-[#7b8170]">Enlace que recibirá el cliente</p><p className="mt-2 break-all text-sm text-[#536445]">{url || savedUrl || 'Seleccione un punto en el mapa'}</p></div>
        {point && <p className="text-xs text-[#8a907e]">{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</p>}
        {(url || savedUrl) && <a className="inline-flex items-center gap-2 text-sm font-medium text-[#65744d]" href={url || savedUrl || ''} target="_blank" rel="noopener noreferrer">Ver en Google Maps<ExternalLink size={14} /></a>}
        <Button className="w-full tracking-normal" disabled={saving || !point || url === savedUrl} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar ubicación'}</Button>
        <p className="text-xs leading-relaxed text-[#8a907e]">Mover el marcador no cambia la ubicación guardada hasta que pulse Guardar.</p>
      </div>
    </section>}
  </div>
}

