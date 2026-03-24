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
  Loader2,
  MapPin,
  Pencil,
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

interface ProjectDetailViewProps {
  projectId: string
}

export function ProjectDetailView({ projectId }: ProjectDetailViewProps) {
  const { supabase } = useAuth()
  const [tenantId, setTenantId] = useState('')
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<TabKey>('resumen')
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
    summary_financial_initial_pvp_total: '',
    summary_financial_min_expected_with_discounts: '',
  })

  useEffect(() => {
    if (!detail) return
    setForm({
      name: detail.name,
      short_description: detail.short_description ?? '',
      description: detail.description ?? '',
      address: detail.address ?? '',
      city: detail.city ?? '',
      country: detail.country ?? 'Ecuador',
      developer_name: detail.developer_name ?? '',
      construction_phase: (detail.construction_phase ?? '') as '' | ProjectConstructionPhase,
      website_url: detail.website_url ?? '',
      contact_phone: detail.contact_phone ?? '',
      contact_email: detail.contact_email ?? '',
      total_units_planned: detail.total_units_planned != null ? String(detail.total_units_planned) : '',
      architects: detail.architects ?? '',
      plan_type: detail.plan_type ?? '',
      estimated_projection_date: detail.estimated_projection_date ?? '',
      summary_financial_initial_pvp_total:
        detail.summary_financial_initial_pvp_total != null ? String(detail.summary_financial_initial_pvp_total) : '',
      summary_financial_min_expected_with_discounts:
        detail.summary_financial_min_expected_with_discounts != null
          ? String(detail.summary_financial_min_expected_with_discounts)
          : '',
    })
  }, [detail])

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
        summary_financial_initial_pvp_total: form.summary_financial_initial_pvp_total
          ? Number(form.summary_financial_initial_pvp_total)
          : null,
        summary_financial_min_expected_with_discounts: form.summary_financial_min_expected_with_discounts
          ? Number(form.summary_financial_min_expected_with_discounts)
          : null,
      })
      toast.success('Proyecto actualizado')
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
            { id: 'resumen' as const, label: 'Resumen', icon: Pencil },
            { id: 'galeria' as const, label: 'Fotos y planos', icon: ImageIcon },
            { id: 'documentos' as const, label: 'Documentos', icon: FileText },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
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

      {tab === 'resumen' && (
        <form onSubmit={handleSaveResumen} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4 max-w-3xl">
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

          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider pt-4">Resumen financiero (referencial)</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              id="p-pvp"
              label="PVP total inicial"
              type="number"
              step="0.01"
              value={form.summary_financial_initial_pvp_total}
              onChange={(e) => updateForm('summary_financial_initial_pvp_total', e.target.value)}
            />
            <Input
              id="p-min"
              label="Mínimo esperado con descuentos"
              type="number"
              step="0.01"
              value={form.summary_financial_min_expected_with_discounts}
              onChange={(e) => updateForm('summary_financial_min_expected_with_discounts', e.target.value)}
            />
          </div>

          <div className="flex justify-end pt-4">
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
