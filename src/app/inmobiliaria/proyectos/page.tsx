'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Building2, ChevronRight, Plus, Search, RotateCcw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getProjectAssetPublicUrl, listProjects } from '@/services/inmobiliaria.service'
import { CreateProjectModal } from '@/components/inmobiliaria/inventory/CreateProjectModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { constructionPhaseLabel } from '@/lib/inmobiliaria/projectLabels'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project } from '@/types/inmobiliaria'

function coverImageUrl(project: Project, supabase: SupabaseClient): string | null {
  const assets = project.project_assets ?? []
  const cover = assets.find((a) => a.kind === 'photo' && a.is_cover) ?? assets.find((a) => a.kind === 'photo')
  if (!cover) return null
  return getProjectAssetPublicUrl(supabase, cover.storage_path)
}

export default function ProyectosPage() {
  const { supabase } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const { data: tenant } = await supabase.from('tenants').select('id').limit(1).single()
      if (tenant) {
        setTenantId(tenant.id)
        const data = await listProjects(supabase, tenant.id)
        setProjects(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsLoading(false)
    }
  }, [supabase])

  useEffect(() => { load() }, [load])

  const filtered = search
    ? projects.filter((p) => {
        const q = search.toLowerCase()
        return (
          p.name.toLowerCase().includes(q) ||
          (p.address ?? '').toLowerCase().includes(q) ||
          (p.city ?? '').toLowerCase().includes(q) ||
          (p.short_description ?? '').toLowerCase().includes(q)
        )
      })
    : projects

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tus proyectos y edificios inmobiliarios
            {projects.length > 0 && <span className="ml-2 text-gray-400">• {projects.length} proyectos</span>}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} className="mr-2" />
          Nuevo Proyecto
        </Button>
      </div>

      {projects.length > 0 && (
        <div className="flex gap-3">
          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar proyecto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#2B1A18] transition-colors"
            />
          </div>
          {search && (
            <Button variant="ghost" size="icon" onClick={() => setSearch('')} title="Limpiar">
              <RotateCcw size={16} />
            </Button>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No hay proyectos"
          description="Crea tu primer proyecto inmobiliario para comenzar a gestionar unidades."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => {
            const img = coverImageUrl(project, supabase)
            return (
              <Link
                key={project.id}
                href={`/inmobiliaria/proyectos/${project.id}`}
                className="group rounded-xl border border-gray-200 bg-white overflow-hidden hover:shadow-lg hover:border-[#BDA27E]/40 transition-all"
              >
                <div className="relative h-40 bg-slate-100">
                  {img ? (
                    <Image src={img} alt="" fill className="object-cover" sizes="(max-width: 1024px) 50vw, 33vw" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Building2 size={40} className="text-[#BDA27E]/40" strokeWidth={1.25} />
                    </div>
                  )}
                  {project.construction_phase && (
                    <span className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {constructionPhaseLabel(project.construction_phase)}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-gray-900 group-hover:text-[#2B1A18] line-clamp-2">{project.name}</h3>
                    <ChevronRight size={18} className="shrink-0 text-gray-300 group-hover:text-[#BDA27E] mt-0.5" />
                  </div>

                  {project.short_description && (
                    <p className="text-sm text-gray-500 line-clamp-2 mb-2">{project.short_description}</p>
                  )}

                  {(project.city || project.address) && (
                    <p className="text-sm text-gray-500 mb-2 line-clamp-1">
                      {[project.city, project.address].filter(Boolean).join(' • ')}
                    </p>
                  )}

                  {project.architects && (
                    <p className="text-xs text-gray-400 mb-2 line-clamp-1">Arq: {project.architects}</p>
                  )}

                  {project.estimated_projection_date && (
                    <div className="mt-2 text-sm">
                      <p className="text-xs text-gray-400">Fecha proyección</p>
                      <p className="font-medium text-gray-700">{formatDate(project.estimated_projection_date)}</p>
                    </div>
                  )}

                  <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs text-gray-400">Creado: {formatDate(project.created_at)}</span>
                    <span className="text-xs font-medium text-[#BDA27E] group-hover:underline">Ver ficha</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <CreateProjectModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
        tenantId={tenantId}
      />
    </div>
  )
}
