'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  Building2,
  Calendar,
  ExternalLink,
  FileText,
  ImageIcon,
  LayoutGrid,
  LayoutList,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  Upload,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  deleteProjectAsset,
  getProjectAssetPublicUrl,
  getProjectDetail,
  PROJECT_ASSETS_BUCKET,
  setProjectCoverPhoto,
  updateProject,
  updateProjectAssetCaption,
  uploadProjectAsset,
} from '@/services/inmobiliaria.service'
import type { ProjectAssetKind, ProjectConstructionPhase, ProjectDetail } from '@/types/inmobiliaria'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { formatDate } from '@/lib/utils'
import { toast } from 'sonner'
import {
  assetKindLabel,
  CONSTRUCTION_PHASE_OPTIONS,
  constructionPhaseLabel,
  PROJECT_ASSET_KIND_OPTIONS,
} from '@/lib/inmobiliaria/projectLabels'

type TabKey = 'resumen' | 'galeria' | 'documentos'

function SummarySection({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof MapPin
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-100 bg-gradient-to-b from-white to-slate-50/90 p-5 shadow-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-4">
        <Icon size={16} className="shrink-0 text-[#BDA27E]" strokeWidth={2} />
        {title}
      </h3>
      <dl className="space-y-3">{children}</dl>
    </section>
  )
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '')
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4 sm:items-baseline">
      <dt className="text-xs font-medium text-slate-500 shrink-0 sm:w-40">{label}</dt>
      <dd className="text-sm text-slate-900 break-words">
        {isEmpty ? <span className="text-slate-400 italic">Sin dato</span> : value}
      </dd>
    </div>
  )
}

interface ProjectDetailViewProps {
  projectId: string
}

export function ProjectDetailView({ projectId }: ProjectDetailViewProps) {
  const { supabase } = useAuth()
  const [tenantId, setTenantId] = useState('')
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('resumen')
  const [editingResumen, setEditingResumen] = useState(false)
  const [saving, setSaving] = useState(false)

  const [uploadKind, setUploadKind] = useState<ProjectAssetKind>('photo')
  const [setAsCover, setSetAsCover] = useState(false)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single()
      if (!tenant) {
        setDetail(null)
        return
      }
      setTenantId(tenant.id)
      const d = await getProjectDetail(supabase, projectId, tenant.id)
      setDetail(d)
    } catch (e) {
      console.error(e)
      toast.error('No se pudo cargar el proyecto')
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [supabase, projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (tab === 'galeria') setUploadKind('photo')
    if (tab === 'documentos') setUploadKind('brochure')
  }, [tab])

  const [form, setForm] = useState({
    name: '',
    short_description: '',
    description: '',
    address: '',
    city: '',
    country: '',
    developer_name: '',
    construction_phase: '' as '' | ProjectConstructionPhase,
    website_url: '',
    contact_phone: '',
    contact_email: '',
    total_units_planned: '',
    architects: '',
    plan_type: '',
    estimated_projection_date: '',
  })

  const applyDetailToForm = useCallback((d: ProjectDetail) => {
    setForm({
      name: d.name,
      short_description: d.short_description ?? '',
      description: d.description ?? '',
      address: d.address ?? '',
      city: d.city ?? '',
      country: d.country ?? 'Ecuador',
      developer_name: d.developer_name ?? '',
      construction_phase: (d.construction_phase ?? '') as '' | ProjectConstructionPhase,
      website_url: d.website_url ?? '',
      contact_phone: d.contact_phone ?? '',
      contact_email: d.contact_email ?? '',
      total_units_planned: d.total_units_planned != null ? String(d.total_units_planned) : '',
      architects: d.architects ?? '',
      plan_type: d.plan_type ?? '',
      estimated_projection_date: d.estimated_projection_date ?? '',
    })
  }, [])

  useEffect(() => {
    if (!detail) return
    applyDetailToForm(detail)
  }, [detail, applyDetailToForm])

  const goTab = (next: TabKey) => {
    if (tab === 'resumen' && next !== 'resumen' && detail) {
      applyDetailToForm(detail)
      setEditingResumen(false)
    }
    setTab(next)
  }

  const updateForm = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSaveResumen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return
    if (!form.name.trim()) {
      toast.error('El nombre es obligatorio')
      return
    }
    setSaving(true)
    try {
      await updateProject(supabase, detail.id, {
        name: form.name.trim(),
        short_description: form.short_description.trim() || null,
        description: form.description.trim() || null,
        address: form.address.trim() || null,
        city: form.city.trim() || null,
        country: form.country.trim() || null,
        developer_name: form.developer_name.trim() || null,
        construction_phase: form.construction_phase || null,
        website_url: form.website_url.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        contact_email: form.contact_email.trim() || null,
        total_units_planned: form.total_units_planned ? parseInt(form.total_units_planned, 10) : null,
        architects: form.architects.trim() || null,
        plan_type: form.plan_type.trim() || null,
        estimated_projection_date: form.estimated_projection_date || null,
      })
      toast.success('Proyecto actualizado')
      setEditingResumen(false)
      await load()
    } catch {
      toast.error('Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !detail || !tenantId) return
    setUploading(true)
    try {
      await uploadProjectAsset(supabase, {
        tenantId,
        projectId: detail.id,
        file,
        kind: uploadKind,
        setAsCover: uploadKind === 'photo' ? setAsCover : false,
      })
      toast.success('Archivo subido')
      setSetAsCover(false)
      await load()
    } catch (err) {
      console.error(err)
      toast.error('Error al subir archivo')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAsset = async (id: string) => {
    if (!confirm('¿Eliminar este archivo?')) return
    try {
      await deleteProjectAsset(supabase, id)
      toast.success('Eliminado')
      await load()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const handleSetCover = async (assetId: string) => {
    if (!detail) return
    try {
      await setProjectCoverPhoto(supabase, detail.id, assetId)
      toast.success('Portada actualizada')
      await load()
    } catch {
      toast.error('Error al guardar portada')
    }
  }

  const handleCaptionBlur = async (assetId: string, caption: string) => {
    try {
      await updateProjectAssetCaption(supabase, assetId, caption.trim() || null)
    } catch {
      toast.error('Error al guardar leyenda')
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-600">
        <p className="mb-4">No se encontró el proyecto o no tienes acceso.</p>
        <Link href="/inmobiliaria/proyectos" className="text-[#2B1A18] font-medium underline">
          Volver a proyectos
        </Link>
      </div>
    )
  }

  const photos = detail.project_assets.filter((a) => a.kind === 'photo')
  const plans = detail.project_assets.filter((a) => a.kind === 'floor_plan')
  const docs = detail.project_assets.filter((a) => ['brochure', 'document', 'other'].includes(a.kind))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/inmobiliaria/proyectos"
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-[#2B1A18] mb-3"
          >
            <ArrowLeft size={16} />
            Proyectos
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{detail.name}</h1>
            {detail.construction_phase && (
              <span className="rounded-full bg-[#BDA27E]/15 px-3 py-1 text-xs font-semibold text-[#2B1A18]">
                {constructionPhaseLabel(detail.construction_phase)}
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-500">
            {detail.city && (
              <span className="flex items-center gap-1">
                <MapPin size={14} /> {detail.city}
                {detail.country ? `, ${detail.country}` : ''}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Building2 size={14} /> {detail.units_count} unidades en inventario
            </span>
            {detail.estimated_projection_date && (
              <span className="flex items-center gap-1">
                <Calendar size={14} /> Proyección {formatDate(detail.estimated_projection_date)}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/inmobiliaria/inventario"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LayoutGrid size={16} />
            Inventario
          </Link>
          {detail.website_url && (
            <a href={detail.website_url} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline" className="gap-2">
                <ExternalLink size={16} /> Web
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {(
          [
            { id: 'resumen' as const, label: 'Resumen', icon: LayoutList },
            { id: 'galeria' as const, label: 'Fotos y planos', icon: ImageIcon },
            { id: 'documentos' as const, label: 'Documentos', icon: FileText },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => goTab(id)}
            className={`flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
              tab === id
                ? 'border-[#2B1A18] text-[#2B1A18]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={16} strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'resumen' && !editingResumen && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm max-w-4xl overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/50 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Resumen del proyecto</h2>
              <p className="mt-1 text-sm text-slate-500">Vista de lectura de la ficha. Pulsa editar para modificar los datos.</p>
            </div>
            <Button type="button" variant="outline" className="shrink-0 gap-2" onClick={() => setEditingResumen(true)}>
              <Pencil size={16} strokeWidth={2} />
              Editar ficha
            </Button>
          </div>

          <div className="p-6 space-y-8">
            <div className="flex flex-wrap gap-2">
              {detail.construction_phase && (
                <span className="inline-flex items-center rounded-full bg-[#BDA27E]/15 px-3 py-1 text-xs font-semibold text-[#2B1A18]">
                  {constructionPhaseLabel(detail.construction_phase)}
                </span>
              )}
              {detail.total_units_planned != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  <Building2 size={14} className="text-slate-400" />
                  {detail.total_units_planned} u. planificadas
                </span>
              )}
              {detail.estimated_projection_date && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700">
                  <Calendar size={14} className="text-slate-400" />
                  Proyección {formatDate(detail.estimated_projection_date)}
                </span>
              )}
            </div>

            <div className="space-y-3">
              {detail.short_description ? (
                <p className="text-lg font-medium leading-snug text-slate-800">{detail.short_description}</p>
              ) : (
                <p className="text-sm text-slate-400 italic">Sin resumen corto. Ideal para listados y tarjetas del proyecto.</p>
              )}
              {detail.description ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-4 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
                  {detail.description}
                </div>
              ) : (
                <p className="text-sm text-slate-400 italic">Aún no hay descripción amplia.</p>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <SummarySection title="Ubicación" icon={MapPin}>
                <SummaryRow label="Dirección" value={detail.address} />
                <SummaryRow label="Ciudad" value={detail.city} />
                <SummaryRow label="País" value={detail.country} />
              </SummarySection>

              <SummarySection title="Promotor y operación" icon={Building2}>
                <SummaryRow label="Constructora / promotora" value={detail.developer_name} />
                <SummaryRow label="Fase" value={detail.construction_phase ? constructionPhaseLabel(detail.construction_phase) : null} />
                <SummaryRow
                  label="Unidades totales (planificadas)"
                  value={detail.total_units_planned != null ? String(detail.total_units_planned) : null}
                />
              </SummarySection>

              <SummarySection title="Contacto" icon={Phone}>
                <SummaryRow label="Teléfono" value={detail.contact_phone} />
                <SummaryRow
                  label="Email"
                  value={
                    detail.contact_email ? (
                      <a href={`mailto:${detail.contact_email}`} className="font-medium text-[#2B1A18] hover:underline">
                        {detail.contact_email}
                      </a>
                    ) : null
                  }
                />
                <SummaryRow
                  label="Sitio web"
                  value={
                    detail.website_url ? (
                      <a
                        href={detail.website_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-[#2B1A18] hover:underline break-all"
                      >
                        {detail.website_url}
                        <ExternalLink size={14} className="shrink-0" />
                      </a>
                    ) : null
                  }
                />
              </SummarySection>

              <SummarySection title="Técnico" icon={FileText}>
                <SummaryRow label="Arquitectos" value={detail.architects} />
                <SummaryRow label="Tipo de plan" value={detail.plan_type} />
                <SummaryRow
                  label="Fecha de proyección / entrega"
                  value={detail.estimated_projection_date ? formatDate(detail.estimated_projection_date) : null}
                />
              </SummarySection>
            </div>
          </div>
        </div>
      )}

      {tab === 'resumen' && editingResumen && (
        <form onSubmit={handleSaveResumen} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-w-3xl">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Editar ficha del proyecto</h2>
              <p className="text-sm text-slate-500">Ajusta los campos y guarda los cambios.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  applyDetailToForm(detail)
                  setEditingResumen(false)
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando...
                  </>
                ) : (
                  'Guardar cambios'
                )}
              </Button>
            </div>
          </div>

          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Información general</h2>
          <Input id="p-name" label="Nombre del proyecto *" value={form.name} onChange={(e) => updateForm('name', e.target.value)} />
          <Input
            id="p-short"
            label="Resumen corto"
            placeholder="Una línea para tarjetas y listados"
            value={form.short_description}
            onChange={(e) => updateForm('short_description', e.target.value)}
          />
          <Textarea
            id="p-desc"
            label="Descripción"
            placeholder="Historia del proyecto, ubicación, diferenciales..."
            value={form.description}
            rows={5}
            onChange={(e) => updateForm('description', e.target.value)}
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Input id="p-addr" label="Dirección" value={form.address} onChange={(e) => updateForm('address', e.target.value)} />
            <Input id="p-city" label="Ciudad" value={form.city} onChange={(e) => updateForm('city', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input id="p-country" label="País" value={form.country} onChange={(e) => updateForm('country', e.target.value)} />
            <Select
              id="p-phase"
              label="Fase"
              options={[{ value: '', label: '—' }, ...CONSTRUCTION_PHASE_OPTIONS]}
              value={form.construction_phase}
              onChange={(e) => updateForm('construction_phase', e.target.value)}
            />
          </div>
          <Input
            id="p-dev"
            label="Constructora / promotora"
            value={form.developer_name}
            onChange={(e) => updateForm('developer_name', e.target.value)}
          />
          <div className="grid sm:grid-cols-2 gap-4">
            <Input id="p-web" label="Sitio web" type="url" placeholder="https://" value={form.website_url} onChange={(e) => updateForm('website_url', e.target.value)} />
            <Input id="p-units" label="Unidades totales (planificadas)" type="number" min={0} value={form.total_units_planned} onChange={(e) => updateForm('total_units_planned', e.target.value)} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input id="p-phone" label="Teléfono de contacto" value={form.contact_phone} onChange={(e) => updateForm('contact_phone', e.target.value)} />
            <Input id="p-email" label="Email de contacto" type="email" value={form.contact_email} onChange={(e) => updateForm('contact_email', e.target.value)} />
          </div>

          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider pt-4">Técnico y comercial</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input id="p-arch" label="Arquitectos" value={form.architects} onChange={(e) => updateForm('architects', e.target.value)} />
            <Input id="p-plan" label="Tipo de plan" value={form.plan_type} onChange={(e) => updateForm('plan_type', e.target.value)} />
          </div>
          <Input
            id="p-projdate"
            label="Fecha de proyección / entrega referencial"
            type="date"
            value={form.estimated_projection_date}
            onChange={(e) => updateForm('estimated_projection_date', e.target.value)}
          />

          <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                applyDetailToForm(detail)
                setEditingResumen(false)
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar cambios'
              )}
            </Button>
          </div>
        </form>
      )}

      {tab === 'galeria' && (
        <div className="space-y-8 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 grid sm:grid-cols-2 gap-4">
              <Select
                id="up-kind"
                label="Tipo de archivo"
                options={PROJECT_ASSET_KIND_OPTIONS.filter((o) => o.value === 'photo' || o.value === 'floor_plan')}
                value={uploadKind}
                onChange={(e) => {
                  setUploadKind(e.target.value as ProjectAssetKind)
                  setSetAsCover(false)
                }}
              />
              {uploadKind === 'photo' && (
                <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer pt-6 sm:pt-0">
                  <input type="checkbox" checked={setAsCover} onChange={(e) => setSetAsCover(e.target.checked)} />
                  Usar como portada del listado
                </label>
              )}
            </div>
            <div>
              <label className="inline-flex">
                <input type="file" className="hidden" accept="image/*,application/pdf" onChange={handleFileUpload} disabled={uploading} />
                <span className="inline-flex items-center gap-2 rounded-lg bg-[#2B1A18] px-4 py-2.5 text-sm font-medium text-white cursor-pointer hover:bg-[#3d2a24] disabled:opacity-50">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={16} />}
                  Subir
                </span>
              </label>
            </div>
          </div>

          <section>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Fotos</h3>
            {photos.length === 0 ? (
              <p className="text-sm text-slate-400">No hay fotos aún.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((a) => (
                  <AssetPhotoCard
                    key={a.id}
                    asset={a}
                    supabase={supabase}
                    onDelete={() => handleDeleteAsset(a.id)}
                    onSetCover={() => handleSetCover(a.id)}
                    onCaptionBlur={(c) => handleCaptionBlur(a.id, c)}
                  />
                ))}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4">Planos</h3>
            {plans.length === 0 ? (
              <p className="text-sm text-slate-400">No hay planos cargados.</p>
            ) : (
              <ul className="space-y-2">
                {plans.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                    <a
                      href={getProjectAssetPublicUrl(supabase, a.storage_path)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-[#2B1A18] hover:underline truncate"
                    >
                      {a.file_name}
                    </a>
                    <button type="button" onClick={() => handleDeleteAsset(a.id)} className="p-2 text-slate-400 hover:text-red-600 cursor-pointer">
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'documentos' && (
        <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 grid sm:grid-cols-2 gap-4">
              <Select
                id="doc-kind"
                label="Tipo"
                options={PROJECT_ASSET_KIND_OPTIONS.filter((o) => !['photo', 'floor_plan'].includes(o.value))}
                value={uploadKind === 'photo' || uploadKind === 'floor_plan' ? 'brochure' : uploadKind}
                onChange={(e) => setUploadKind(e.target.value as ProjectAssetKind)}
              />
            </div>
            <div>
              <label className="inline-flex">
                <input type="file" className="hidden" accept=".pdf,.doc,.docx,application/pdf" onChange={handleFileUpload} disabled={uploading} />
                <span className="inline-flex items-center gap-2 rounded-lg bg-[#2B1A18] px-4 py-2.5 text-sm font-medium text-white cursor-pointer hover:bg-[#3d2a24]">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload size={16} />}
                  Subir documento
                </span>
              </label>
            </div>
          </div>

          {docs.length === 0 ? (
            <p className="text-sm text-slate-400">No hay documentos.</p>
          ) : (
            <ul className="space-y-2">
              {docs.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                  <div>
                    <span className="text-xs text-slate-400">{assetKindLabel(a.kind)}</span>
                    <a
                      href={getProjectAssetPublicUrl(supabase, a.storage_path)}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-medium text-[#2B1A18] hover:underline truncate max-w-md"
                    >
                      {a.file_name}
                    </a>
                  </div>
                  <button type="button" onClick={() => handleDeleteAsset(a.id)} className="p-2 text-slate-400 hover:text-red-600 cursor-pointer">
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function AssetPhotoCard({
  asset,
  supabase,
  onDelete,
  onSetCover,
  onCaptionBlur,
}: {
  asset: import('@/types/inmobiliaria').ProjectAsset
  supabase: import('@supabase/supabase-js').SupabaseClient
  onDelete: () => void
  onSetCover: () => void
  onCaptionBlur: (caption: string) => void
}) {
  const url = getProjectAssetPublicUrl(supabase, asset.storage_path)
  const [cap, setCap] = useState(() => asset.caption ?? '')
  useEffect(() => {
    setCap(asset.caption ?? '')
  }, [asset.caption, asset.id])

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
      <div className="relative aspect-[4/3] bg-slate-200">
        {asset.mime_type?.startsWith('image/') ? (
          <Image src={url} alt={asset.file_name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 33vw" />
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="flex h-full items-center justify-center text-sm text-[#2B1A18] underline p-4">
            Ver archivo
          </a>
        )}
        {asset.is_cover && (
          <span className="absolute top-2 left-2 rounded bg-[#2B1A18] px-2 py-0.5 text-[10px] font-bold text-white">PORTADA</span>
        )}
      </div>
      <div className="p-3 space-y-2">
        <input
          className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white"
          placeholder="Leyenda (opcional)"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          onBlur={() => onCaptionBlur(cap)}
        />
        <div className="flex gap-2">
          {!asset.is_cover && asset.mime_type?.startsWith('image/') && (
            <button type="button" onClick={onSetCover} className="text-xs text-[#BDA27E] font-semibold hover:underline cursor-pointer">
              Portada
            </button>
          )}
          <button type="button" onClick={onDelete} className="text-xs text-red-500 ml-auto cursor-pointer flex items-center gap-1">
            <Trash2 size={12} /> Quitar
          </button>
        </div>
      </div>
    </div>
  )
}
