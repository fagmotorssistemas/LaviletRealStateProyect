'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Settings2, Clock3, Users, ChartNoAxesColumnIncreasing, CalendarClock } from 'lucide-react'
import { AutomationSettingsHeader, AutomationSettingsSummary, AutomationSettingsSections, AutomationSettingsPanel as RulesCard, automationSettingsStyles as styles } from './AutomationSettings'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { useAuth } from '@/contexts/AuthContext'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
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
  saveSalespersonAction,
  saveScoringRuleAction,
} from '@/app/inmobiliaria/automatizacion/actions'
import {
  AUTOMATION_MODE_OPTIONS,
  TIMEZONE_OPTIONS,
  type ProjectAutomationConfig,
  type ProjectSalespersonRow,
  type ScoringRuleRow,
} from '@/types/automationRules'
import type { Project, TeamProfile } from '@/types/inmobiliaria'
import { Nutrition24hSettings } from './Nutrition24hSettings'
import { NutritionWeekOneSettings } from './NutritionWeekOneSettings'
import { NutritionLaterSettings } from './NutritionLaterSettings'
import { nutritionLaterConfig, type LaterConfig, type LaterWeek } from '@/lib/inmobiliaria/nutritionLater'
import { nutritionWeekOneConfig, type NutritionWeekOneConfig } from '@/lib/inmobiliaria/nutritionWeekOne'
import { nutrition24hConfig, type Nutrition24hConfig } from '@/lib/inmobiliaria/nutrition24h'
import { BotVisitSettings } from './BotVisitSettings'
import { botVisitPolicy, type BotVisitPolicy } from '@/lib/inmobiliaria/botVisits'

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

type AutomationAudience = {
  enabled: boolean
  dryRun: boolean
  restricted: boolean
  allowedLeadId: string | null
  allowedLeadName: string | null
  allowedPhone: string | null
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
  const [nutrition24h, setNutrition24h] = useState<Nutrition24hConfig>(nutrition24hConfig(null))
  const [nutritionWeekOne, setNutritionWeekOne] = useState<NutritionWeekOneConfig>(nutritionWeekOneConfig(null))
  const [nutritionLater, setNutritionLater] = useState<Record<LaterWeek, LaterConfig>>(nutritionLaterConfig(null))
  const [automationAudience, setAutomationAudience] = useState<AutomationAudience | null>(null)
  const [projectUpdatedAt, setProjectUpdatedAt] = useState('')
  const [botVisits, setBotVisits] = useState<BotVisitPolicy>(botVisitPolicy(null, 'lanzamiento'))
  const [addPersonId, setAddPersonId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [section, setSection] = useState('horario')

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
    setProjectId((current) => rows.some((project) => project.id === current)
      ? current
      : rows.find((project) => project.id === LAVILET_PROJECT_ID)?.id || rows[0]?.id || '')
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
      setNutrition24h(payload.nutrition24h)
      setNutritionWeekOne(payload.nutritionWeekOne)
      setNutritionLater(payload.nutritionLater)
      setAutomationAudience(payload.automationAudience)
      setProjectUpdatedAt(payload.projectUpdatedAt)
      setBotVisits(payload.botVisits)
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

  if (roleLoading || !isAdmin) {
    return (
      <div className="flex justify-center py-20">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className={styles.shell}>
      <AutomationSettingsHeader
        active="reglas"
        title="Reglas y SLA"
        description="Organice la atención del equipo, los tiempos de respuesta y el seguimiento comercial."
        project={
        <Select
          label="Proyecto"
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          placeholder="Elige un proyecto"
          value={projectId}
          disabled={saving !== null}
          onChange={(event) => setProjectId(event.target.value)}
        />
        }
      />

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
          <AutomationSettingsSummary items={[
            { label: 'Revisión de citas', value: <>{config.review_sla_minutes} <small>minutos</small></>, detail: 'Plazo objetivo para atender la solicitud', icon: Clock3 },
            { label: 'Equipo en rotación', value: salespeople.filter(person => person.receives_leads && person.is_active !== false).length, detail: 'Asesores habilitados para recibir leads', icon: Users },
            { label: 'Secuencia de seguimiento', value: nutrition24h.enabled && nutritionWeekOne.enabled && nutritionLater[2].enabled && nutritionLater[3].enabled ? 'Completa' : 'Parcial', detail: '24 horas, días 7, 14 y 21', icon: CalendarClock, muted: !(nutrition24h.enabled || nutritionWeekOne.enabled || nutritionLater[2].enabled || nutritionLater[3].enabled) },
            { label: 'Alcance automático', value: automationAudience?.restricted ? 'Solo Carlos' : 'Todos los leads', detail: automationAudience?.restricted ? automationAudience.allowedPhone || '0987110032' : 'Sin restricción por lead', icon: Users, muted: !automationAudience?.enabled || automationAudience?.dryRun },
          ]} />
          <AutomationSettingsSections selected={section} onSelect={setSection} sections={[
            { id: 'horario', label: 'Horario y SLA', detail: 'Jornada y plazos de atención', icon: Clock3 },
            { id: 'equipo', label: 'Equipo y rotación', detail: 'Asignación de leads y citas', icon: Users },
            { id: 'visitas-bot', label: 'Visitas del bot', detail: 'Invitaciones y lugar de atención', icon: Settings2 },
            { id: 'puntaje', label: 'Calificación de leads', detail: 'Puntajes y nivel de interés', icon: ChartNoAxesColumnIncreasing },
            { id: 'seguimiento', label: 'Seguimiento', detail: '24 horas y semanas', icon: CalendarClock },
          ]}>
          <RulesCard id="visitas-bot" title="Visitas que puede proponer el bot" description="Controle si el bot invita a conocer el terreno o a conversar en la oficina.">
            {projectId === LAVILET_PROJECT_ID ? <BotVisitSettings key={`${projectId}:${projectUpdatedAt}`} projectId={projectId} initial={botVisits} mode={config.mode} updatedAt={projectUpdatedAt} onSaved={() => loadRules(projectId)} /> : <p>Esta configuración está disponible para La Vilet.</p>}
          </RulesCard>
          <RulesCard
            id="horario"
            title="Horario y tiempos de atención"
            description="Defina la jornada de los asesores y los plazos para revisar las solicitudes de visita."
            action={
              <Button onClick={() => void saveConfig()} disabled={saving === 'config'}>
                {saving === 'config' ? 'Guardando...' : 'Guardar'}
              </Button>
            }
          >
            <div className={styles.notice}>
              <strong>¿Qué significa SLA?</strong>
              <p>Es el plazo objetivo de atención del equipo: {config.sla_response_minutes} minutos para responder tras un traspaso a un asesor y {config.review_sla_minutes} minutos para revisar una solicitud de cita.</p>
              <p>Estos plazos permiten detectar solicitudes vencidas. No son una espera que el bot deba cumplir antes de responder.</p>
            </div>
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
              <div className="rounded-xl border border-[#e3e6dc] p-3 text-sm">
                <p className="font-medium text-[#535c48]">Ubicación de las visitas</p>
                <p className="mt-1 text-xs text-[#858a7c]">Selecciona el punto del proyecto en el mapa. Se compartirá al confirmar la cita.</p>
                <a className="mt-2 inline-block font-medium text-[#667253] underline underline-offset-4" href="/inmobiliaria/automatizacion/ubicacion">Editar ubicación en el mapa</a>
              </div>
              <div className="flex items-end pb-2">
                <Toggle
                  checked={config.is_active}
                  onChange={(value) => patchConfig('is_active', value)}
                  label="Configuración habilitada"
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
                          aria-label={`${day.label}: atención habilitada`}
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
                          aria-label={`${day.label}: hora de apertura`}
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
                          aria-label={`${day.label}: hora de cierre`}
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
              Esta jornada se utiliza para coordinar visitas y derivar solicitudes al equipo. La pausa de la IA de cada lead se administra desde Monitoreo.
            </p>
          </RulesCard>

          <RulesCard
            id="equipo"
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
            id="puntaje"
            title="Calificación de leads"
            description="Los límites de interés se guardan por proyecto. Los puntos por evento son reglas compartidas de la plataforma."
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
            id="seguimiento"
            title="Seguimiento de clientes"
            description="Configure los mensajes de 24 horas y de los días 7, 14 y 21."
          >
            <div className="mb-8 rounded-xl border border-[#d8ddcc] bg-[#f3f5ec] p-4 text-sm text-[#535c48]">
              <p className="font-semibold">Configuración operativa</p>
              <p className="mt-1">Estos controles son la fuente que utiliza el ejecutor para programar mensajes reales.</p>
              <p className="mt-2">
                Alcance actual: <strong>{automationAudience?.restricted ? `${automationAudience.allowedLeadName || 'Carlos'} · ${automationAudience.allowedPhone || '0987110032'}` : 'todos los leads'}</strong>.
                {automationAudience?.restricted ? ' Los demás leads permanecen con DETENER IA activo.' : ''}
              </p>
              {automationAudience?.dryRun && <p className="mt-2 font-semibold text-[#8a5c58]">El ejecutor está en simulación y no enviará mensajes.</p>}
              {automationAudience && !automationAudience.enabled && <p className="mt-2 font-semibold text-[#8a5c58]">El ejecutor está deshabilitado en la base de datos.</p>}
            </div>
            {projectId === LAVILET_PROJECT_ID && <div className="mb-8 border-b border-[#deded4] pb-8"><h3 className="mb-4 text-lg font-semibold">Seguimiento de 24 horas</h3><Nutrition24hSettings key={`${projectId}:${projectUpdatedAt}`} projectId={projectId} initial={nutrition24h} updatedAt={projectUpdatedAt} onSaved={(value, updatedAt) => { setNutrition24h(value); setProjectUpdatedAt(updatedAt) }} /></div>}
            {projectId === LAVILET_PROJECT_ID && <div className="mb-8 border-b border-[#deded4] pb-8"><h3 className="mb-4 text-lg font-semibold">Día 7: brochure o seguimiento</h3><NutritionWeekOneSettings key={`week1:${projectId}:${projectUpdatedAt}`} projectId={projectId} initial={nutritionWeekOne} updatedAt={projectUpdatedAt} onSaved={(value, updatedAt) => { setNutritionWeekOne(value); setProjectUpdatedAt(updatedAt) }} /></div>}
            {projectId === LAVILET_PROJECT_ID && <div><h3 className="mb-4 text-lg font-semibold">Días 14 y 21</h3><NutritionLaterSettings key={`later:${projectId}:${projectUpdatedAt}`} projectId={projectId} initial={nutritionLater} updatedAt={projectUpdatedAt} onSaved={(value, updatedAt) => { setNutritionLater(value); setProjectUpdatedAt(updatedAt) }} /></div>}
          </RulesCard>
          </AutomationSettingsSections>
        </>
      )}
    </div>
  )
}
