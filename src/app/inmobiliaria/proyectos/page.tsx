'use client'

import { useEffect, useState, useCallback } from 'react'
import { Building2, Plus, Search, RotateCcw } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { listProjects } from '@/services/inmobiliaria.service'
import { CreateProjectModal } from '@/components/inmobiliaria/inventory/CreateProjectModal'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import type { Project } from '@/types/inmobiliaria'

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
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.address ?? '').toLowerCase().includes(search.toLowerCase())
      )
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
          {filtered.map((project) => (
            <div
              key={project.id}
              className="rounded-xl border border-gray-200 bg-white p-5 hover:shadow-md transition-shadow cursor-pointer"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#BDA27E]/15">
                  <Building2 size={20} className="text-[#2B1A18]" />
                </div>
                <h3 className="font-semibold text-gray-900 truncate">{project.name}</h3>
              </div>

              {project.address && (
                <p className="text-sm text-gray-500 mb-2 truncate">{project.address}</p>
              )}

              {project.architects && (
                <p className="text-xs text-gray-400 mb-2">Arq: {project.architects}</p>
              )}

              <div className="grid grid-cols-2 gap-2 text-sm">
                {project.summary_financial_initial_pvp_total != null && (
                  <div>
                    <p className="text-xs text-gray-400">PVP Total</p>
                    <PriceText value={project.summary_financial_initial_pvp_total} size="sm" />
                  </div>
                )}
                {project.summary_financial_min_expected_with_discounts != null && (
                  <div>
                    <p className="text-xs text-gray-400">Mín. esperado</p>
                    <PriceText value={project.summary_financial_min_expected_with_discounts} size="sm" />
                  </div>
                )}
              </div>

              {project.estimated_projection_date && (
                <div className="mt-2 text-sm">
                  <p className="text-xs text-gray-400">Fecha proyección</p>
                  <p className="font-medium text-gray-700">{formatDate(project.estimated_projection_date)}</p>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">Creado: {formatDate(project.created_at)}</span>
              </div>
            </div>
          ))}
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
