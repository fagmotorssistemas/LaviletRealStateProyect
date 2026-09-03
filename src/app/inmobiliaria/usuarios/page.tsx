'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { TourHeatmap } from '@/components/inmobiliaria/users/TourHeatmap'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/contexts/AuthContext'
import { USER_ROLE_OPTIONS, roleLabel } from '@/lib/inmobiliaria/roleAccess'
import { formatDate, formatSeconds } from '@/lib/utils'
import type { UserRole } from '@/types/inmobiliaria'
import {
  listManagedUsersAction,
  listTourMetricsAction,
  updateUserRoleAction,
  type ManagedUser,
  type TourGlobalMetrics,
  type TourUserMetrics,
} from './actions'

export default function UsuariosPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [metrics, setMetrics] = useState<TourUserMetrics[]>([])
  const [global, setGlobal] = useState<TourGlobalMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const [nextUsers, nextMetrics] = await Promise.all([
        listManagedUsersAction(),
        listTourMetricsAction(),
      ])
      setUsers(nextUsers)
      setMetrics(nextMetrics.byUser)
      setGlobal(nextMetrics.global)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const metricsByUser = useMemo(
    () => new Map(metrics.map((item) => [item.profileId, item])),
    [metrics],
  )

  const changeRole = async (userId: string, role: UserRole) => {
    setSavingId(userId)
    try {
      await updateUserRoleAction(userId, role)
      setUsers((current) => current.map((item) => (item.id === userId ? { ...item, role } : item)))
      toast.success('Rol actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el rol')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administración"
        title="Gestión de usuarios"
        description="Roles del equipo y permanencia en el showroom 360°"
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="crm-stat">
          <p className="crm-stat-label">Usuarios</p>
          <p className="crm-stat-value">{users.length}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Recorrieron el 360°</p>
          <p className="crm-stat-value">{global?.activeUsers ?? 0}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Tipología más vista</p>
          <p className="crm-stat-value text-[1.35rem]">{global?.topTypology ?? '—'}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Ambiente más visto</p>
          <p className="crm-stat-value text-[1.35rem]">{global?.topRoom ?? '—'}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : users.length === 0 ? (
        <EmptyState icon={Users} title="No hay usuarios" description="Aún no hay perfiles registrados." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-600">Usuario</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Rol</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Tipología</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Ambiente</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Unidad</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Tiempo 360°</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Alta</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => {
                const tour = metricsByUser.get(item.id)
                return (
                  <tr
                    key={item.id}
                    className="cursor-pointer border-b border-gray-50 hover:bg-gray-50/70"
                    onClick={() => setSelectedId(item.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{item.full_name || 'Sin nombre'}</p>
                      <p className="text-xs text-gray-500">{item.phone || item.email || '—'}</p>
                    </td>
                    <td className="px-4 py-3 min-w-[12rem]" onClick={(event) => event.stopPropagation()}>
                      <Select
                        options={USER_ROLE_OPTIONS}
                        value={item.role}
                        disabled={savingId === item.id || item.id === user?.id}
                        onChange={(event) => void changeRole(item.id, event.target.value as UserRole)}
                        aria-label={`Rol de ${item.full_name || item.email || 'usuario'}`}
                      />
                      {item.id === user?.id && (
                        <p className="mt-1 text-[11px] text-gray-400">Tu usuario · {roleLabel(item.role)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{tour?.topTypology ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{tour?.topRoom ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{tour?.topUnit ?? '—'}</td>
                    <td className="px-4 py-3 text-right crm-num text-gray-700">
                      {tour ? formatSeconds(tour.totalSeconds) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(item.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedId && (
        <Modal
          isOpen
          onClose={() => setSelectedId(null)}
          title={users.find((item) => item.id === selectedId)?.full_name || 'Mapa de calor'}
          size="xl"
        >
          <p className="mb-4 text-sm text-gray-500">
            Tiempo por tipología y ambiente. El color más intenso es donde más se quedó.
          </p>
          <TourHeatmap cells={metricsByUser.get(selectedId)?.cells ?? []} />
        </Modal>
      )}
    </div>
  )
}
