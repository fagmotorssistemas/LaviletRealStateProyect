'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Building2, ChevronRight, Plus, Search, RotateCcw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { getProjectAssetPublicUrl, listProjects } from '@/services/inmobiliaria.service'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { CreateProjectModal } from '@/components/inmobiliaria/inventory/CreateProjectModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
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
  const { canWrite } = useRoleAccess()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const tenantIds = await getAccessibleTenantIds(supabase)
      if (tenantIds.length) {
        setTenantId(tenantIds[0])
        const data = await listProjects(supabase, tenantIds[0], tenantIds)
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
    <div className="space-y-4">
      <PageHeader
        eyebrow="Desarrollos"
        title="Proyectos"
        description={
          <>
            Edificios y desarrollos inmobiliarios
            {projects.length > 0 && (
              <span className="text-[#9a7d55]"> · {projects.length} registros</span>
            )}
          </>
        }
        actions={
          canWrite ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={16} className="mr-2" />
              Nuevo proyecto
            </Button>
          ) : undefined
        }
      />

      {projects.length > 0 && (
        <div className="flex gap-3">
          <div className="relative w-full sm:w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar proyecto..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-sm border border-[#8b917c]/55 bg-[#f7f7f3] pl-9 pr-3 text-sm placeholder:text-[#8a8d82] focus:outline-none focus:ring-2 focus:ring-[#8b917c]/35 focus:border-[#3a3d36] transition-colors"
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
                className="crm-project-card group overflow-hidden"
              >
                <div className="relative h-44 bg-[#3a3d36]">
                  {img ? (
                    <Image src={img} alt="" fill className="object-cover" sizes="(max-width: 1024px) 50vw, 33vw" />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <Building2 size={40} className="text-[#8b917c]/40" strokeWidth={1.25} />
                    </div>
                  )}
                  {project.construction_phase && (
                    <span className="absolute bottom-2 left-2 border border-[#8b917c]/50 bg-[#3a3d36]/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#ead9be]">
                      {constructionPhaseLabel(project.construction_phase)}
                    </span>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-display text-lg font-semibold text-[#3a3d36] line-clamp-2">{project.name}</h3>
                    <ChevronRight size={18} className="shrink-0 text-gray-300 group-hover:text-[#8b917c] mt-0.5" />
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

                  <div className="mt-3 flex items-center justify-between border-t border-[#8b917c]/35 pt-3">
                    <span className="text-xs text-[#6b5348]">Creado: {formatDate(project.created_at)}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a7d55] group-hover:underline">
                      Ver ficha
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {canWrite && (
        <CreateProjectModal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={load}
          tenantId={tenantId}
        />
      )}
    </div>
  )
}
