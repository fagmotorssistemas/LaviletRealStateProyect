'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Settings2 } from 'lucide-react'
import { AutomationSectionTabs } from '@/components/inmobiliaria/automation/AutomationSectionTabs'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listProjects } from '@/services/inmobiliaria.service'
import {
  defaultAutomationConfig,
  hoursToWeekdays,
  weekdaysToHours,
  type WeekdayHours,
} from '@/lib/inmobiliaria/automationRules'
import { formatDateTime } from '@/lib/utils'
import {
  addSalespersonAction,
  loadAutomationRulesAction,
  saveAutomationConfigAction,
  saveNutritionStepsAction,
  saveSalespersonAction,
  saveScoringRuleAction,
  seedNutritionStepsAction,
} from '@/app/inmobiliaria/automatizacion/actions'
import {
  AUTOMATION_MODE_OPTIONS,
  TIMEZONE_OPTIONS,
  type NutritionStepRow,
  type ProjectAutomationConfig,
  type ProjectSalespersonRow,
  type ScoringRuleRow,
} from '@/types/automationRules'
import type { Project, TeamProfile } from '@/types/inmobiliaria'

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-[#3a3d36]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded border-gray-300"
      />
      {label}
    </label>
  )
}

function RulesCard({
  title,
  description,
  action,
  children,
}: {
  title: string
  description: string
  action: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold text-[#3a3d36]">{title}</h2>
          <p className="mt-1 text-sm text-[#7a7e70]">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function AutomationRulesView() {
  const router = useRouter()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const { supabase, user, isLoading: authLoading } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [profiles, setProfiles] = useState<TeamProfile[]>([])
  const [config, setConfig] = useState<ProjectAutomationConfig | null>(null)
  const [days, setDays] = useState<WeekdayHours[]>(hoursToWeekdays(null))
  const [salespeople, setSalespeople] = useState<ProjectSalespersonRow[]>([])
  const [scoring, setScoring] = useState<ScoringRuleRow[]>([])
  const [nutrition, setNutrition] = useState<NutritionStepRow[]>([])
  const [addPersonId, setAddPersonId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    if (roleLoading) return
    if (!isAdmin) router.replace('/inmobiliaria/automatizacion')
  }, [isAdmin, roleLoading, router])

  const loadProjects = useCallback(async () => {
    if (authLoading || !user) return
    const ids = await getAccessibleTenantIds(supabase)
    if (!ids.length) {
      setProjects([])
      return
    }
    const rows = await listProjects(supabase, ids[0], ids)
    setProjects(rows)
    setProjectId((current) => current || rows[0]?.id || '')
  }, [authLoading, supabase, user])

  const loadRules = useCallback(async (id: string) => {
    if (!id) return
    setIsLoading(true)
    try {
      const payload = await loadAutomationRulesAction(id)
      setTenantId(payload.tenantId)
      setProfiles(payload.profiles)
      const nextConfig = payload.config ?? defaultAutomationConfig(id, payload.tenantId)
      setConfig(nextConfig)
      setDays(hoursToWeekdays(nextConfig.business_hours))
      setSalespeople(payload.salespeople)
      setScoring(payload.scoringRules)
      setNutrition(payload.nutritionSteps)
      setAddPersonId('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron cargar las reglas')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (!projectId || !isAdmin) {
      if (!projectId && isAdmin) setIsLoading(false)
      return
    }
    void loadRules(projectId)
  }, [isAdmin, loadRules, projectId])

  const availableProfiles = useMemo(
    () => profiles.filter((profile) => !salespeople.some((row) => row.salesperson_id === profile.id)),
    [profiles, salespeople],
  )

  const patchConfig = <K extends keyof ProjectAutomationConfig>(key: K, value: ProjectAutomationConfig[K]) => {
    setConfig((current) => (current ? { ...current, [key]: value } : current))
  }
  const selectedProject = projects.find((project) => project.id === projectId)

  const saveConfig = async () => {
    if (!config) return
    setSaving('config')
    try {
      await saveAutomationConfigAction({
        ...config,
        business_hours: weekdaysToHours(days),
      })
      toast.success('Horario y modo guardados')
      await loadRules(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el horario')
    } finally {
      setSaving(null)
    }
  }

  const savePerson = async (row: ProjectSalespersonRow) => {
    setSaving(`team-${row.id}`)
    try {
      await saveSalespersonAction({
        id: row.id,
        receives_leads: row.receives_leads,
        receives_bot_appointments: row.receives_bot_appointments,
        rotation_order: row.rotation_order,
      })
      toast.success('Rotación actualizada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el equipo')
    } finally {
      setSaving(null)
    }
  }

  const addPerson = async () => {
    if (!addPersonId || !tenantId) return
    setSaving('add-person')
    try {
      const nextOrder = (salespeople.reduce((max, row) => Math.max(max, row.rotation_order), 0) || 0) + 1
      await addSalespersonAction({
        tenantId,
        projectId,
        salespersonId: addPersonId,
        rotationOrder: nextOrder,
      })
      toast.success('Asesor añadido a la rotación')
      await loadRules(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo añadir el asesor')
    } finally {
      setSaving(null)
    }
  }

  const saveRule = async (row: ScoringRuleRow) => {
    setSaving(`score-${row.event_type}`)
    try {
      await saveScoringRuleAction({
        event_type: row.event_type,
        points: row.points,
        repeatable: row.repeatable,
        active: row.active,
      })
      toast.success('Puntaje actualizado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el puntaje')
    } finally {
      setSaving(null)
    }
  }

  const saveNutrition = async () => {
    setSaving('nutrition')
    try {
      await saveNutritionStepsAction(nutrition)
      toast.success('Nutrición guardada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la nutrición')
    } finally {
      setSaving(null)
    }
  }

  const seedNutrition = async () => {
    setSaving('nutrition-seed')
    try {
      await seedNutritionStepsAction(projectId)
      toast.success('Secuencia de 4 semanas creada')
      await loadRules(projectId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la secuencia')
    } finally {
      setSaving(null)
    }
  }

  if (roleLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Automatización"
        title="Reglas"
        description="Horario, equipo, puntaje y nutrición. Las preguntas y respuestas del bot están en Guion."
      />
      <AutomationSectionTabs active="reglas" />

      <div className="max-w-sm">
        <Select
          label="Proyecto"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          placeholder="Elige un proyecto"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
        />
      </div>

      {projects.length === 0 ? (
        <EmptyState
          icon={Settings2}
          title="No hay proyectos"
          description="Crea un proyecto antes de configurar las reglas del bot."
        />
      ) : isLoading || !config ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <>
          <RulesCard
            title="Horario y modo"
            description="Modo del bot, zona horaria y jornada. El horario hábil también alimenta is_project_open (handoff). El plazo de revisión de citas no es el SLA de traspaso."
            action={
              <Button onClick={() => void saveConfig()} disabled={saving === 'config'}>
                {saving === 'config' ? 'Guardando...' : 'Guardar'}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Select
                label="Modo"
                options={AUTOMATION_MODE_OPTIONS}
                value={config.mode}
                onChange={(event) => patchConfig('mode', event.target.value as ProjectAutomationConfig['mode'])}
              />
              <Select
                label="Zona horaria"
                options={TIMEZONE_OPTIONS}
                value={config.timezone}
                onChange={(event) => patchConfig('timezone', event.target.value)}
              />
              <Select
                label="Admin de escalamiento"
                options={[
                  { value: '', label: 'Sin asignar' },
                  ...profiles.map((profile) => ({
                    value: profile.id,
                    label: profile.full_name || 'Sin nombre',
                  })),
                ]}
                value={config.admin_profile_id ?? ''}
                onChange={(event) => patchConfig('admin_profile_id', event.target.value || null)}
              />
              <Input
                id="review-sla"
                label="Plazo de revisión de citas (minutos)"
                type="number"
                min={15}
                max={10080}
                value={config.review_sla_minutes}
                onChange={(event) => patchConfig('review_sla_minutes', Number(event.target.value) || 90)}
              />
              <Input
                id="hold-minutes"
                label="Reserva temporal de horario (minutos)"
                type="number"
                min={15}
                max={1440}
                value={config.proposal_hold_minutes}
                onChange={(event) => patchConfig('proposal_hold_minutes', Number(event.target.value) || 120)}
              />
              <Input
                id="max-reassign"
                label="Máximo de reasignaciones automáticas"
                type="number"
                min={1}
                max={10}
                value={config.max_auto_reassignments}
                onChange={(event) => patchConfig('max_auto_reassignments', Number(event.target.value) || 3)}
              />
              {selectedProject?.name.toUpperCase().includes('LA VILET') ? (
                <Input
                  id="visit-location-url"
                  label="Enlace de ubicación (solo este proyecto)"
                  value={config.visit_location_url ?? ''}
                  onChange={(event) => patchConfig('visit_location_url', event.target.value || null)}
                />
              ) : null}
              <div className="flex items-end pb-2">
                <Toggle
                  checked={config.is_active}
                  onChange={(value) => patchConfig('is_active', value)}
                  label="Motor activo"
                />
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f7f3ee] text-left text-[#7a7e70]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Día</th>
                    <th className="px-4 py-2 font-medium">Abierto</th>
                    <th className="px-4 py-2 font-medium">Desde</th>
                    <th className="px-4 py-2 font-medium">Hasta</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day, index) => (
                    <tr key={day.iso} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-medium text-[#3a3d36]">{day.label}</td>
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={day.enabled}
                          onChange={(event) =>
                            setDays((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, enabled: event.target.checked } : item,
                              ),
                            )
                          }
                          className="h-4 w-4 rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          value={day.open}
                          disabled={!day.enabled}
                          onChange={(event) =>
                            setDays((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, open: event.target.value } : item,
                              ),
                            )
                          }
                          className="crm-field h-9 w-32"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="time"
                          value={day.close}
                          disabled={!day.enabled}
                          onChange={(event) =>
                            setDays((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, close: event.target.value } : item,
                              ),
                            )
                          }
                          className="crm-field h-9 w-32"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[#7a7e70]">
              Este horario también lo consume el handoff (`is_project_open`). Cambiarlo afecta visitas y traspaso.
              El plazo de revisión de citas es distinto de `sla_response_minutes` (SLA de handoff); no se reescribe aquí.
            </p>
          </RulesCard>

          <RulesCard
            title="Equipo y rotación"
            description="Quién recibe leads de este proyecto. Apagar a alguien no lo saca del equipo."
            action={null}
          >
            {salespeople.length === 0 ? (
              <EmptyState
                icon={Settings2}
                title="Nadie en rotación"
                description="Añade un asesor activo para que el traspaso tenga a quién asignar."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#f7f3ee] text-left text-[#7a7e70]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Asesor</th>
                      <th className="px-4 py-2 font-medium">WhatsApp</th>
                      <th className="px-4 py-2 font-medium">Orden</th>
                      <th className="px-4 py-2 font-medium">Recibe leads</th>
                      <th className="px-4 py-2 font-medium">Citas del bot</th>
                      <th className="px-4 py-2 font-medium">Último lead</th>
                      <th className="px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {salespeople.map((row, index) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <p className="font-semibold text-[#3a3d36]">{row.full_name || 'Sin nombre'}</p>
                          {row.is_active === false ? (
                            <p className="text-xs text-[#8a5c58]">Perfil inactivo</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2 text-[#555850]">
                          {row.phone || <span className="text-[#8a5c58]">Sin número</span>}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min={1}
                            value={row.rotation_order}
                            onChange={(event) =>
                              setSalespeople((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, rotation_order: Number(event.target.value) || 1 }
                                    : item,
                                ),
                              )
                            }
                            className="crm-field h-9 w-20"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Toggle
                            checked={row.receives_leads}
                            onChange={(value) =>
                              setSalespeople((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, receives_leads: value } : item,
                                ),
                              )
                            }
                            label={row.receives_leads ? 'Sí' : 'No'}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Toggle
                            checked={row.receives_bot_appointments}
                            onChange={(value) =>
                              setSalespeople((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, receives_bot_appointments: value } : item,
                                ),
                              )
                            }
                            label={row.receives_bot_appointments ? 'Sí' : 'No'}
                          />
                        </td>
                        <td className="px-4 py-2 text-[#7a7e70]">
                          {row.last_lead_assigned_at ? formatDateTime(row.last_lead_assigned_at) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void savePerson(row)}
                            disabled={saving === `team-${row.id}`}
                          >
                            Guardar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <Select
                  label="Añadir al proyecto"
                  options={availableProfiles.map((profile) => ({
                    value: profile.id,
                    label: profile.full_name || 'Sin nombre',
                  }))}
                  placeholder={availableProfiles.length ? 'Elige un perfil' : 'No hay más perfiles'}
                  value={addPersonId}
                  onChange={(event) => setAddPersonId(event.target.value)}
                />
              </div>
              <Button onClick={() => void addPerson()} disabled={!addPersonId || saving === 'add-person'}>
                Añadir a rotación
              </Button>
            </div>
          </RulesCard>

          <RulesCard
            title="Puntaje"
            description="Cortes de temperatura y puntos por evento. No se pueden borrar eventos; solo ajustar."
            action={
              <Button onClick={() => void saveConfig()} disabled={saving === 'config'}>
                {saving === 'config' ? 'Guardando...' : 'Guardar cortes'}
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                id="warm-min"
                label="Tibio desde (puntos)"
                type="number"
                min={1}
                value={config.temperature_warm_min}
                onChange={(event) => patchConfig('temperature_warm_min', Number(event.target.value) || 25)}
              />
              <Input
                id="hot-min"
                label="Caliente desde (puntos)"
                type="number"
                min={2}
                value={config.temperature_hot_min}
                onChange={(event) => patchConfig('temperature_hot_min', Number(event.target.value) || 60)}
              />
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-sm">
                <thead className="bg-[#f7f3ee] text-left text-[#7a7e70]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Evento</th>
                    <th className="px-4 py-2 font-medium">Motivo</th>
                    <th className="px-4 py-2 font-medium">Puntos</th>
                    <th className="px-4 py-2 font-medium">Repetible</th>
                    <th className="px-4 py-2 font-medium">Activo</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {scoring.map((row, index) => (
                    <tr key={row.event_type} className="border-t border-gray-100">
                      <td className="px-4 py-2 font-mono text-xs text-[#555850]">{row.event_type}</td>
                      <td className="px-4 py-2 text-[#3a3d36]">{row.reason}</td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={row.points}
                          onChange={(event) =>
                            setScoring((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, points: Number(event.target.value) || 0 }
                                  : item,
                              ),
                            )
                          }
                          className="crm-field h-9 w-20"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Toggle
                          checked={row.repeatable}
                          onChange={(value) =>
                            setScoring((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, repeatable: value } : item,
                              ),
                            )
                          }
                          label=""
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Toggle
                          checked={row.active}
                          onChange={(value) =>
                            setScoring((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, active: value } : item,
                              ),
                            )
                          }
                          label=""
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void saveRule(row)}
                          disabled={saving === `score-${row.event_type}`}
                        >
                          Guardar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </RulesCard>

          <RulesCard
            title="Nutrición"
            description="Secuencia de 4 semanas. Sin plantilla aprobada por Meta no se envía fuera de la ventana de 24 horas."
            action={
              nutrition.length ? (
                <Button onClick={() => void saveNutrition()} disabled={saving === 'nutrition'}>
                  {saving === 'nutrition' ? 'Guardando...' : 'Guardar'}
                </Button>
              ) : (
                <Button onClick={() => void seedNutrition()} disabled={saving === 'nutrition-seed'}>
                  Crear 4 semanas
                </Button>
              )
            }
          >
            {nutrition.length === 0 ? (
              <EmptyState
                icon={Settings2}
                title="Todavía no hay plantillas"
                description="Crea la secuencia con temas de lanzamiento. Márcalas como aprobadas cuando Meta las confirme."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#f7f3ee] text-left text-[#7a7e70]">
                    <tr>
                      <th className="px-4 py-2 font-medium">Semana</th>
                      <th className="px-4 py-2 font-medium">Tema</th>
                      <th className="px-4 py-2 font-medium">Template Meta</th>
                      <th className="px-4 py-2 font-medium">Aprobado</th>
                      <th className="px-4 py-2 font-medium">Activo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nutrition.map((row, index) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-semibold text-[#3a3d36]">{row.week_number}</td>
                        <td className="px-4 py-2">
                          <input
                            value={row.topic}
                            onChange={(event) =>
                              setNutrition((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, topic: event.target.value } : item,
                                ),
                              )
                            }
                            className="crm-field h-9 min-w-48"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            value={row.meta_template_name}
                            onChange={(event) =>
                              setNutrition((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, meta_template_name: event.target.value }
                                    : item,
                                ),
                              )
                            }
                            className="crm-field h-9 min-w-48 font-mono text-xs"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Toggle
                            checked={row.is_approved}
                            onChange={(value) =>
                              setNutrition((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, is_approved: value } : item,
                                ),
                              )
                            }
                            label=""
                          />
                        </td>
                        <td className="px-4 py-2">
                          <Toggle
                            checked={row.active}
                            onChange={(value) =>
                              setNutrition((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, active: value } : item,
                                ),
                              )
                            }
                            label=""
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RulesCard>
        </>
      )}
    </div>
  )
}
