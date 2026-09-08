'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useAuth } from '@/contexts/AuthContext'
import {
  CRM_VIEW_OPTIONS,
  USER_ROLE_OPTIONS,
  pathsForRole,
  roleLabel,
} from '@/lib/inmobiliaria/roleAccess'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types/inmobiliaria'
import {
  createManagedUserAction,
  listManagedUsersAction,
  setUserActiveAction,
  updateUserPathsAction,
  updateUserRoleAction,
  type ManagedUser,
} from './actions'

const STAFF_ROLE_OPTIONS = USER_ROLE_OPTIONS.filter((item) => item.value !== 'visitante')

function ViewChecks({
  value,
  onChange,
  disabled,
}: {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const groups = [
    { id: 'ventas' as const, label: 'Ventas' },
    { id: 'contabilidad' as const, label: 'Contabilidad' },
    { id: 'admin' as const, label: 'Administración' },
  ]

  const toggle = (href: string) => {
    if (value.includes(href)) onChange(value.filter((item) => item !== href))
    else onChange([...value, href])
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const options = CRM_VIEW_OPTIONS.filter((item) => item.group === group.id)
        if (options.length === 0) return null
        return (
          <div key={group.id} className="space-y-2">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#8a8d87] uppercase">{group.label}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {options.map((item) => {
                const checked = value.includes(item.href)
                return (
                  <label
                    key={item.href}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                      checked
                        ? 'border-[#787D62]/35 bg-[#787D62]/8 text-[#3a3d36]'
                        : 'border-[#2B1A18]/10 bg-white text-[#555850]',
                      disabled && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-[#787D62]"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(item.href)}
                    />
                    {item.label}
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function UsuariosPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createdPassword, setCreatedPassword] = useState<string | null>(null)

  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formPassword, setFormPassword] = useState('')
  const [formPaths, setFormPaths] = useState<string[]>(pathsForRole('asesor'))
  const [editPaths, setEditPaths] = useState<string[]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      setUsers(await listManagedUsersAction())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activeCount = users.filter((item) => item.is_active && !item.access_pending).length
  const inactiveCount = users.filter((item) => !item.is_active).length
  const pendingCount = users.filter((item) => item.access_pending).length
  const editUser = users.find((item) => item.id === editId) ?? null

  const resetCreateForm = () => {
    setFormName('')
    setFormEmail('')
    setFormPhone('')
    setFormPassword('')
    setFormPaths(pathsForRole('asesor'))
    setCreatedPassword(null)
  }

  const changeRole = async (userId: string, role: UserRole) => {
    setSavingId(userId)
    try {
      const result = await updateUserRoleAction(userId, role)
      setUsers((current) =>
        current.map((item) =>
          item.id === userId
            ? {
                ...item,
                role: result.role,
                crm_paths: result.paths,
                access_pending: false,
              }
            : item,
        ),
      )
      toast.success('Rol y vistas actualizados')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el rol')
    } finally {
      setSavingId(null)
    }
  }

  const toggleActive = async (item: ManagedUser) => {
    setSavingId(item.id)
    try {
      await setUserActiveAction(item.id, !item.is_active)
      setUsers((current) =>
        current.map((row) => (row.id === item.id ? { ...row, is_active: !item.is_active } : row)),
      )
      toast.success(
        item.is_active
          ? 'Perfil desactivado. El historial de leads y ventas se conserva.'
          : 'Perfil reactivado',
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado')
    } finally {
      setSavingId(null)
    }
  }

  const savePaths = async () => {
    if (!editId) return
    setSavingId(editId)
    try {
      const result = await updateUserPathsAction(editId, editPaths)
      setUsers((current) =>
        current.map((item) =>
          item.id === editId
            ? {
                ...item,
                role: result.role,
                crm_paths: result.paths,
                access_pending: false,
              }
            : item,
        ),
      )
      toast.success(
        editUser?.access_pending
          ? 'Acceso aprobado. Ya puede entrar con sus vistas.'
          : 'Vistas actualizadas',
      )
      setEditId(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar las vistas')
    } finally {
      setSavingId(null)
    }
  }

  const createUser = async () => {
    setCreating(true)
    try {
      const result = await createManagedUserAction({
        full_name: formName,
        email: formEmail,
        phone: formPhone,
        password: formPassword || undefined,
        paths: formPaths,
      })
      setUsers((current) => [result.user, ...current])
      setCreatedPassword(result.temporaryPassword)
      toast.success('Usuario creado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el usuario')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Administración"
        title="Gestión de usuarios"
        description="Creá perfiles, elegí las vistas de acceso y desactivá cuentas sin perder el historial."
        actions={
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => {
              resetCreateForm()
              setCreateOpen(true)
            }}
          >
            <Plus size={16} className="mr-2" />
            Nuevo usuario
          </Button>
        }
      />

      {pendingCount > 0 ? (
        <div className="rounded-xl border border-[#BDA27E]/40 bg-[#f7f3ee] px-4 py-3 text-sm text-[#3a3d36]">
          <p className="font-semibold text-[#2B1A18]">
            {pendingCount === 1
              ? 'Hay 1 cuenta nueva esperando acceso'
              : `Hay ${pendingCount} cuentas nuevas esperando acceso`}
          </p>
          <p className="mt-1 text-[#555850]">
            Asignales las vistas necesarias con el botón <span className="font-semibold">Vistas</span> /
            <span className="font-semibold"> Asignar acceso</span>. Hasta entonces no pueden entrar al CRM.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="crm-stat">
          <p className="crm-stat-label">Equipo CRM</p>
          <p className="crm-stat-value">{users.length}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Pendientes</p>
          <p className="crm-stat-value">{pendingCount}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Activos</p>
          <p className="crm-stat-value">{activeCount}</p>
        </div>
        <div className="crm-stat">
          <p className="crm-stat-label">Desactivados</p>
          <p className="crm-stat-value">{inactiveCount}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No hay usuarios del equipo"
          description="Creá el primer perfil y asignale las vistas que puede usar."
        />
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {users.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'rounded-2xl border border-[#2B1A18]/8 bg-white p-4',
                  !item.is_active && 'bg-[#f7f3ee]/70',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#2B1A18]">
                      {item.full_name || 'Sin nombre'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-[#8a8d87]">
                      {item.email || item.phone || '—'}
                    </p>
                    {item.id === user?.id ? (
                      <p className="mt-1 text-[11px] text-[#8a8d87]">Tu usuario</p>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase',
                      item.access_pending
                        ? 'bg-[#BDA27E]/25 text-[#7a6240]'
                        : item.is_active
                          ? 'bg-[#787D62]/15 text-[#555850]'
                          : 'bg-[#2B1A18]/8 text-[#8a8d87]',
                    )}
                  >
                    {item.access_pending ? 'Pendiente' : item.is_active ? 'Activo' : 'Desactivado'}
                  </span>
                </div>

                <div className="mt-3">
                  <Select
                    label="Rol"
                    options={STAFF_ROLE_OPTIONS}
                    value={item.role === 'visitante' ? 'asesor' : item.role}
                    disabled={savingId === item.id || item.id === user?.id}
                    onChange={(event) => void changeRole(item.id, event.target.value as UserRole)}
                    aria-label={`Rol de ${item.full_name || item.email || 'usuario'}`}
                  />
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={item.access_pending ? 'primary' : 'outline'}
                    className="w-full"
                    disabled={savingId === item.id}
                    onClick={() => {
                      setEditPaths(item.crm_paths.length > 0 ? item.crm_paths : pathsForRole('asesor'))
                      setEditId(item.id)
                    }}
                  >
                    {item.access_pending ? 'Asignar acceso' : 'Vistas'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={item.is_active ? 'secondary' : 'primary'}
                    className="w-full"
                    disabled={savingId === item.id || item.id === user?.id}
                    onClick={() => void toggleActive(item)}
                  >
                    {item.is_active ? 'Desactivar' : 'Activar'}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto rounded-xl border border-[#2B1A18]/8 bg-white md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2B1A18]/8 bg-[#fafaf7]">
                  <th className="px-4 py-3 text-left font-medium text-[#555850]">Usuario</th>
                  <th className="px-4 py-3 text-left font-medium text-[#555850]">Estado</th>
                  <th className="px-4 py-3 text-left font-medium text-[#555850]">Rol</th>
                  <th className="px-4 py-3 text-right font-medium text-[#555850]">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr
                    key={item.id}
                    className={cn(
                      'border-b border-[#2B1A18]/5',
                      !item.is_active && 'bg-[#f7f3ee]/70',
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-[#2B1A18]">{item.full_name || 'Sin nombre'}</p>
                      <p className="text-xs text-[#8a8d87]">{item.email || item.phone || '—'}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase',
                          item.access_pending
                            ? 'bg-[#BDA27E]/25 text-[#7a6240]'
                            : item.is_active
                              ? 'bg-[#787D62]/15 text-[#555850]'
                              : 'bg-[#2B1A18]/8 text-[#8a8d87]',
                        )}
                      >
                        {item.access_pending ? 'Pendiente' : item.is_active ? 'Activo' : 'Desactivado'}
                      </span>
                    </td>
                    <td className="min-w-[11rem] px-4 py-3">
                      <Select
                        options={STAFF_ROLE_OPTIONS}
                        value={item.role === 'visitante' ? 'asesor' : item.role}
                        disabled={savingId === item.id || item.id === user?.id}
                        onChange={(event) => void changeRole(item.id, event.target.value as UserRole)}
                        aria-label={`Rol de ${item.full_name || item.email || 'usuario'}`}
                      />
                      {item.id === user?.id ? (
                        <p className="mt-1 text-[11px] text-[#8a8d87]">Tu usuario · {roleLabel(item.role)}</p>
                      ) : item.access_pending ? (
                        <p className="mt-1 text-[11px] text-[#7a6240]">Asigná vistas para aprobar el acceso</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant={item.access_pending ? 'primary' : 'outline'}
                          disabled={savingId === item.id}
                          onClick={() => {
                            setEditPaths(
                              item.crm_paths.length > 0 ? item.crm_paths : pathsForRole('asesor'),
                            )
                            setEditId(item.id)
                          }}
                        >
                          {item.access_pending ? 'Asignar acceso' : 'Vistas'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={item.is_active ? 'secondary' : 'primary'}
                          disabled={savingId === item.id || item.id === user?.id}
                          onClick={() => void toggleActive(item)}
                        >
                          {item.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (creating) return
          setCreateOpen(false)
          resetCreateForm()
        }}
        title="Nuevo usuario"
        size="lg"
      >
        {createdPassword ? (
          <div className="space-y-4">
            <p className="text-sm text-[#555850]">
              Usuario creado. Guardá esta contraseña: solo se muestra ahora.
            </p>
            <div className="rounded-lg border border-[#2B1A18]/10 bg-[#fafaf7] px-3 py-3 font-mono text-sm text-[#2B1A18]">
              {createdPassword}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  setCreateOpen(false)
                  resetCreateForm()
                }}
              >
                Listo
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Nombre"
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  placeholder="Nombre completo"
                />
              </div>
              <Input
                label="Correo"
                type="email"
                value={formEmail}
                onChange={(event) => setFormEmail(event.target.value)}
                placeholder="correo@empresa.com"
              />
              <Input
                label="Celular"
                value={formPhone}
                onChange={(event) => setFormPhone(event.target.value)}
                placeholder="Opcional"
              />
              <div className="sm:col-span-2">
                <Input
                  label="Contraseña temporal"
                  value={formPassword}
                  onChange={(event) => setFormPassword(event.target.value)}
                  placeholder="Vacío = se genera automáticamente"
                />
              </div>
            </div>

            <div className="space-y-2">
              <p className="crm-field-label">Vistas con acceso</p>
              <ViewChecks value={formPaths} onChange={setFormPaths} disabled={creating} />
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={creating} onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" disabled={creating} onClick={() => void createUser()}>
                {creating ? 'Creando…' : 'Crear perfil'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={Boolean(editId)}
        onClose={() => {
          if (savingId === editId) return
          setEditId(null)
        }}
        title={
          editUser?.access_pending
            ? `Asignar acceso · ${editUser.full_name || 'Usuario'}`
            : `Vistas · ${editUser?.full_name || 'Usuario'}`
        }
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-[#8a8d87]">
            {editUser?.access_pending
              ? 'Esta persona se registró sola. Elegí las secciones que puede usar para aprobar su acceso al CRM.'
              : 'Elegí qué secciones puede abrir. Si lo desactivás después, estas asignaciones y su historial se conservan.'}
          </p>
          <ViewChecks
            value={editPaths}
            onChange={setEditPaths}
            disabled={savingId === editId}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditId(null)}>
              Cancelar
            </Button>
            <Button type="button" disabled={savingId === editId} onClick={() => void savePaths()}>
              {editUser?.access_pending ? 'Aprobar y guardar' : 'Guardar vistas'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
