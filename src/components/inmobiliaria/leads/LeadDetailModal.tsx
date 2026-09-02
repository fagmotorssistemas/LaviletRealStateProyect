'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Phone, DollarSign, CreditCard, MessageSquare,
  Edit3, Loader2, CheckCircle2, Building2, Send, Plus,
  Trash2, ChevronDown, Calendar, MapPin, ChevronLeft, ChevronRight, User,
} from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { PersonCell } from '@/components/inmobiliaria/shared/PersonCell'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { LEAD_STATUS_OPTIONS, INTERACTION_TYPE_OPTIONS, LEAD_TEMPERATURE_OPTIONS } from '@/types/inmobiliaria'
import type { Lead, LeadStatus, LeadTemperature, LeadInteraction, InteractionType, Unit, Project, TeamProfile } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import {
  getLead, updateLead, updateLeadStatus, updateLeadTemperature, updateLeadAssignee,
  listLeadInteractions, addLeadInteraction,
  addLeadUnit, removeLeadUnit,
  listProjects,
} from '@/services/inmobiliaria.service'
import { LeadDetailAgendaTab } from '@/components/inmobiliaria/leads/LeadDetailAgendaTab'
import { LeadDetailShowroomTab } from '@/components/inmobiliaria/leads/LeadDetailShowroomTab'
import { UnitNumberSearchInput } from '@/components/inmobiliaria/shared/UnitNumberSearchInput'
import { formatDateTime, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

interface LeadDetailModalProps {
  leadId: string | null
  isOpen: boolean
  onClose: () => void
  onUpdated: () => void
  tenantId: string
  advisors: TeamProfile[]
}

export function LeadDetailModal({ leadId, isOpen, onClose, onUpdated, tenantId, advisors }: LeadDetailModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [lead, setLead] = useState<Lead | null>(null)
  const [interactions, setInteractions] = useState<LeadInteraction[]>([])
  const [loading, setLoading] = useState(false)

  // Sidebar editable state
  const [resume, setResume] = useState('')
  const [isSavingResume, setIsSavingResume] = useState(false)
  const [budget, setBudget] = useState('')
  const [wantsFinancing, setWantsFinancing] = useState(false)
  const [isSavingFinance, setIsSavingFinance] = useState(false)

  // Status dropdown
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)
  const statusRef = useRef<HTMLDivElement>(null)
  const [temperatureDropdownOpen, setTemperatureDropdownOpen] = useState(false)
  const temperatureRef = useRef<HTMLDivElement>(null)

  // Unit search
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)

  // Interaction form
  const [interactionType, setInteractionType] = useState<InteractionType>('seguimiento')
  const [interactionContent, setInteractionContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** Pestaña derecha: bitácora, agenda o showroom */
  const [rightTab, setRightTab] = useState<'historial' | 'agenda' | 'showroom'>('historial')
  const [projects, setProjects] = useState<Project[]>([])
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!leadId || !isOpen) return
    setLoading(true)
    getLead(supabase, leadId, scope)
      .then((leadData) => {
        const advisor = advisors.find((a) => a.id === leadData.assigned_to)
        if (advisor) {
          leadData.assigned_profile = { full_name: advisor.full_name, avatar_url: advisor.avatar_url }
        }
        setLead(leadData)
        setResume(leadData.resume || '')
        setBudget(leadData.budget?.toString() || '')
        setWantsFinancing(leadData.financing || false)
        return listLeadInteractions(supabase, leadId)
      })
      .then((interactionsData) => {
        setInteractions(interactionsData)
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Error al cargar el lead')
        setLead(null)
        setInteractions([])
        onClose()
      })
      .finally(() => setLoading(false))
  }, [supabase, leadId, isOpen, scope, onClose, advisors])

  useEffect(() => {
    if (!isOpen) setRightTab('historial')
  }, [isOpen])

  useEffect(() => {
    setRightTab('historial')
  }, [leadId])

  useEffect(() => {
    if (!tenantId || !isOpen || !leadId) return
    listProjects(supabase, tenantId).then(setProjects).catch(() => setProjects([]))
  }, [supabase, tenantId, isOpen, leadId])

  const scrollTabs = (dir: 'left' | 'right') => {
    const el = tabsScrollRef.current
    if (!el) return
    const delta = dir === 'left' ? -120 : 120
    el.scrollBy({ left: delta, behavior: 'smooth' })
  }

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  // Close status dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusDropdownOpen(false)
      }
    }
    if (statusDropdownOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [statusDropdownOpen])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (temperatureRef.current && !temperatureRef.current.contains(e.target as Node)) {
        setTemperatureDropdownOpen(false)
      }
    }
    if (temperatureDropdownOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [temperatureDropdownOpen])

  // ─── Handlers ──────────────────────────────────────────────

  const handleSaveResume = async () => {
    if (!lead || resume === (lead.resume || '')) return
    setIsSavingResume(true)
    try {
      await updateLead(supabase, lead.id, { resume })
      lead.resume = resume
    } catch { /* silent */ }
    setIsSavingResume(false)
  }

  const handleSaveFinance = async (newBudget?: string, newFinancing?: boolean) => {
    if (!lead) return
    setIsSavingFinance(true)
    const budgetVal = parseFloat(newBudget ?? budget) || 0
    const financingVal = newFinancing ?? wantsFinancing
    try {
      await updateLead(supabase, lead.id, { budget: budgetVal, financing: financingVal })
      lead.budget = budgetVal
      lead.financing = financingVal
    } catch { /* silent */ }
    setIsSavingFinance(false)
  }

  const handleStatusChange = async (status: LeadStatus) => {
    if (!lead || status === lead.status) return
    setStatusDropdownOpen(false)
    try {
      await updateLeadStatus(supabase, lead.id, status)
      toast.success('Estado actualizado')
      onUpdated()
      const updated = await getLead(supabase, lead.id, scope)
      setLead(updated)
    } catch {
      toast.error('Error al actualizar')
    }
  }

  const handleTemperatureChange = async (temperature: LeadTemperature) => {
    if (!lead || temperature === (lead.temperature || 'frio')) return
    setTemperatureDropdownOpen(false)
    try {
      await updateLeadTemperature(supabase, lead.id, temperature)
      toast.success('Temperatura actualizada')
      onUpdated()
      const updated = await getLead(supabase, lead.id, scope)
      setLead(updated)
    } catch {
      toast.error('Error al actualizar la temperatura')
    }
  }

  const handleAssigneeChange = async (assignedTo: string) => {
    if (!lead) return
    const next = assignedTo || null
    if (next === (lead.assigned_to || null)) return
    try {
      await updateLeadAssignee(supabase, lead.id, next)
      toast.success(next ? 'Responsable actualizado' : 'Lead sin asignar')
      onUpdated()
      const updated = await getLead(supabase, lead.id, scope)
      const advisor = advisors.find((a) => a.id === updated.assigned_to)
      if (advisor) {
        updated.assigned_profile = { full_name: advisor.full_name, avatar_url: advisor.avatar_url }
      } else if (!updated.assigned_to) {
        updated.assigned_profile = undefined
      }
      setLead(updated)
    } catch {
      toast.error('No se pudo asignar el responsable')
    }
  }

  const handleAddInteraction = async () => {
    if (!lead || !interactionContent.trim() || !user) return
    setSubmitting(true)
    try {
      await addLeadInteraction(supabase, {
        tenant_id: tenantId,
        lead_id: lead.id,
        responsible_id: user.id,
        type: interactionType,
        content: interactionContent,
      })
      setInteractionContent('')
      const updated = await listLeadInteractions(supabase, lead.id)
      setInteractions(updated)
      toast.success('Interacción registrada')
    } catch {
      toast.error('Error al registrar interacción')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddUnit = async (unit: Unit) => {
    if (!lead) return
    try {
      await addLeadUnit(supabase, lead.id, unit.id, lead.lead_units?.length ?? 0)
      const updated = await getLead(supabase, lead.id, scope)
      setLead(updated)
      toast.success('Unidad agregada')
    } catch {
      toast.error('Error al agregar unidad')
    }
  }

  const handleRemoveUnit = async (unitId: string) => {
    if (!lead) return
    try {
      await removeLeadUnit(supabase, lead.id, unitId)
      const updated = await getLead(supabase, lead.id, scope)
      setLead(updated)
      toast.success('Unidad eliminada')
    } catch {
      toast.error('Error al eliminar unidad')
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4">
      <div className="crm-sheet flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-slate-900/5 sm:h-[90vh] sm:rounded-xl animate-in zoom-in-95 duration-200">

        {/* ── HEADER ── */}
        <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
          {loading || !lead ? (
            <div className="h-6 w-48 rounded bg-slate-100 animate-pulse" />
          ) : (
            <>
              {/* Left: avatar + info */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#3a3d36] text-white text-sm font-bold shrink-0">
                  {lead.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 truncate">{lead.name}</h2>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                    {lead.phone && (
                      <span className="flex items-center gap-1"><Phone size={12} />{lead.phone}</span>
                    )}
                    <PersonCell
                      name={lead.assigned_profile?.full_name}
                      avatarUrl={lead.assigned_profile?.avatar_url}
                      emptyLabel="Sin responsable"
                      size="sm"
                    />
                  </div>
                </div>
              </div>

              {/* Right: temperature + status dropdowns + close */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="relative" ref={temperatureRef}>
                  <button
                    onClick={() => setTemperatureDropdownOpen(!temperatureDropdownOpen)}
                    className="flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-80"
                    title="Temperatura del lead"
                  >
                    <StatusBadge status={lead.temperature || 'frio'} type="temperature" />
                    {typeof lead.temperature_score === 'number' && (
                      <span className="text-[11px] text-slate-400 tabular-nums" title="Score de temperatura">
                        {lead.temperature_score}
                      </span>
                    )}
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${temperatureDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {temperatureDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-50 py-1 overflow-hidden">
                      {LEAD_TEMPERATURE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleTemperatureChange(opt.value)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                            (lead.temperature || 'frio') === opt.value
                              ? 'bg-slate-50 font-semibold text-[#3a3d36]'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            (lead.temperature || 'frio') === opt.value ? 'bg-[#3a3d36]' : 'bg-slate-300'
                          }`} />
                          {opt.label}
                          {(lead.temperature || 'frio') === opt.value && (
                            <span className="ml-auto text-[10px] text-slate-400 uppercase tracking-wider">Actual</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="relative" ref={statusRef}>
                  <button
                    onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                    className="flex items-center gap-1.5 cursor-pointer transition-opacity hover:opacity-80"
                  >
                    <StatusBadge status={lead.status} type="lead" />
                    <ChevronDown size={14} className={`text-slate-400 transition-transform ${statusDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {statusDropdownOpen && (
                    <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl border border-slate-200 shadow-xl z-50 py-1 overflow-hidden">
                      {LEAD_STATUS_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => handleStatusChange(opt.value)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer ${
                            lead.status === opt.value
                              ? 'bg-slate-50 font-semibold text-[#3a3d36]'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            lead.status === opt.value ? 'bg-[#3a3d36]' : 'bg-slate-300'
                          }`} />
                          {opt.label}
                          {lead.status === opt.value && (
                            <span className="ml-auto text-[10px] text-slate-400 uppercase tracking-wider">Actual</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  onClick={onClose}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── BODY ── */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : lead ? (
          <div className="flex flex-1 overflow-hidden flex-col md:flex-row h-full">

            {/* ── LEFT SIDEBAR ── */}
            <div className="max-h-64 w-full overflow-y-auto border-b border-slate-200 bg-slate-50 md:block md:max-h-none md:h-full md:w-1/3 md:overflow-y-auto md:border-b-0 md:border-r">
              <div className="p-6 space-y-8">

                {/* Resumen Ejecutivo */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <Edit3 className="h-3 w-3" /> Resumen Ejecutivo
                    </label>
                    <div className="flex items-center gap-1.5 h-4">
                      {isSavingResume ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-[#8b917c]" />
                          <span className="text-[10px] text-[#8b917c]">Guardando...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                          <span className="text-[10px] text-slate-400">Guardado</span>
                        </>
                      )}
                    </div>
                  </div>
                  <textarea
                    value={resume}
                    onChange={(e) => setResume(e.target.value)}
                    onBlur={handleSaveResume}
                    placeholder="Estatus actual del prospecto..."
                    className="crm-field min-h-[120px] p-4"
                  />
                </div>

                {/* Unidades de Interés */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Unidades de Interés
                    </label>
                    <button
                      onClick={() => setUnitSearchOpen(!unitSearchOpen)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-[#8b917c] hover:text-[#a88d6a] cursor-pointer transition-colors uppercase tracking-wider"
                    >
                      <Plus size={12} /> Agregar
                    </button>
                  </div>

                  {unitSearchOpen && (
                    <UnitNumberSearchInput
                      tenantId={tenantId}
                      excludeIds={lead.lead_units?.map((lu) => lu.unit_id)}
                      onSelect={handleAddUnit}
                    />
                  )}

                  {/* Unit list */}
                  {lead.lead_units && lead.lead_units.length > 0 ? (
                    <div className="space-y-3">
                      {lead.lead_units.map((lu) => (
                        <div key={lu.unit_id} className="flex items-center gap-3 border border-[#2B1A18]/12 bg-white p-3 group">
                          <div className="p-2 bg-slate-100 rounded-lg">
                            <Building2 className="h-4 w-4 text-slate-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-sm text-slate-800 block truncate">
                              {lu.unit?.unit_number}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              {lu.unit?.published_commercial_price && (
                                <span className="crm-num text-xs text-slate-500">
                                  {formatCurrency(lu.unit.published_commercial_price)}
                                </span>
                              )}
                              {lu.unit?.project?.name && (
                                <span className="text-xs text-slate-400">• {lu.unit.project.name}</span>
                              )}
                            </div>
                          </div>
                          {lu.unit?.status && (
                            <StatusBadge status={lu.unit.status} type="unit" className="shrink-0" />
                          )}
                          <button
                            onClick={() => handleRemoveUnit(lu.unit_id)}
                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
                            title="Eliminar unidad"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="border border-dashed border-[#2B1A18]/12 bg-white p-3 text-center text-sm italic text-[#8a8d87]">
                      Sin unidades seleccionadas.
                    </p>
                  )}
                </div>

                {/* Responsable */}
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2 mb-3">
                    <User className="h-3 w-3" /> Responsable
                  </label>
                  <div className="space-y-3 border border-[#2B1A18]/12 bg-white p-4">
                    <PersonCell
                      name={lead.assigned_profile?.full_name}
                      avatarUrl={lead.assigned_profile?.avatar_url}
                      emptyLabel="Nadie atiende este lead"
                    />
                    <Select
                      id="lead-assignee"
                      options={advisors.map((a) => ({ value: a.id, label: a.full_name || 'Sin nombre' }))}
                      placeholder="Sin asignar"
                      value={lead.assigned_to ?? ''}
                      onChange={(e) => handleAssigneeChange(e.target.value)}
                    />
                  </div>
                </div>

                {/* Detalles Financieros */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <DollarSign className="h-3 w-3" /> Detalles Financieros
                    </label>
                    {isSavingFinance && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                  </div>

                  <div className="space-y-4 border border-[#2B1A18]/12 bg-white p-5">
                    <div>
                      <label className="text-[10px] text-slate-400 uppercase font-bold mb-1 block">
                        Presupuesto ($)
                      </label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                          type="number"
                          value={budget}
                          onChange={(e) => setBudget(e.target.value)}
                          onBlur={() => handleSaveFinance(budget)}
                          className="crm-field crm-field-icon bg-[#fcfbf9] font-semibold"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <CreditCard className="h-4 w-4 text-blue-500" />
                        <span className="text-sm font-medium text-slate-700">Solicita Financiamiento</span>
                      </div>
                      <button
                        onClick={() => {
                          const newVal = !wantsFinancing
                          setWantsFinancing(newVal)
                          handleSaveFinance(undefined, newVal)
                        }}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${wantsFinancing ? 'bg-blue-500' : 'bg-slate-200'}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${wantsFinancing ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* ── RIGHT COLUMN (Pestañas: Historial / Agenda / Showroom) ── */}
            <div className="w-full md:w-2/3 flex flex-col bg-white h-full overflow-hidden min-h-0">

              {/* Barra de pestañas (scroll horizontal) */}
              <div className="shrink-0 flex items-stretch gap-1 border-b border-slate-200 bg-white px-2">
                <button
                  type="button"
                  onClick={() => scrollTabs('left')}
                  className="shrink-0 px-1 py-3 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                  aria-label="Desplazar pestañas a la izquierda"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <div
                  ref={tabsScrollRef}
                  className="flex-1 min-w-0 flex items-stretch gap-1 overflow-x-auto scrollbar-thin py-0 [scrollbar-width:thin]"
                >
                  <button
                    type="button"
                    onClick={() => setRightTab('historial')}
                    className={`shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                      rightTab === 'historial'
                        ? 'border-[#3a3d36] text-[#3a3d36]'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    Historial
                    {interactions.length > 0 && (
                      <span className="text-xs text-slate-400 font-normal">({interactions.length})</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('agenda')}
                    className={`shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                      rightTab === 'agenda'
                        ? 'border-[#3a3d36] text-[#3a3d36]'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Calendar className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    Agenda
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightTab('showroom')}
                    className={`shrink-0 flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                      rightTab === 'showroom'
                        ? 'border-[#3a3d36] text-[#3a3d36]'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MapPin className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                    Showroom
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => scrollTabs('right')}
                  className="shrink-0 px-1 py-3 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                  aria-label="Desplazar pestañas a la derecha"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {rightTab === 'historial' && (
                <>
                  {/* Timeline */}
                  <div className="flex-1 overflow-y-auto p-6 min-h-0">
                    {interactions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-full min-h-[200px] text-slate-400">
                        <MessageSquare size={40} strokeWidth={1.5} className="mb-3" />
                        <p className="text-sm font-medium">Sin interacciones registradas</p>
                        <p className="text-xs mt-1">Agrega la primera interacción con este prospecto</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {interactions.map((interaction) => (
                          <div key={interaction.id} className="flex gap-3">
                            <div className="mt-1 shrink-0">
                              <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                                <MessageSquare size={14} className="text-slate-500" />
                              </div>
                            </div>
                            <div className="flex-1 border border-[#2B1A18]/12 bg-[#fcfbf9] p-4">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="inline-flex items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 uppercase tracking-wider">
                                  {interaction.type}
                                </span>
                                <span className="text-xs text-slate-400">{formatDateTime(interaction.created_at)}</span>
                                {interaction.responsible?.full_name && (
                                  <span className="text-xs text-slate-400">• {interaction.responsible.full_name}</span>
                                )}
                              </div>
                              <p className="text-sm text-slate-700">{interaction.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Input Form */}
                  <div className="shrink-0 border-t border-slate-200 bg-white p-4">
                    <div className="flex items-end gap-3">
                      <div className="w-32 shrink-0">
                        <Select
                          options={INTERACTION_TYPE_OPTIONS}
                          value={interactionType}
                          onChange={(e) => setInteractionType(e.target.value as InteractionType)}
                        />
                      </div>
                      <div className="flex-1">
                        <textarea
                          value={interactionContent}
                          onChange={(e) => setInteractionContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              handleAddInteraction()
                            }
                          }}
                          placeholder="Escribe una interacción..."
                          rows={2}
                          className="crm-field min-h-[44px] resize-y bg-[#fcfbf9]"
                        />
                      </div>
                      <button
                        onClick={handleAddInteraction}
                        disabled={submitting || !interactionContent.trim()}
                        className="shrink-0 rounded-lg bg-[#3a3d36] p-2.5 text-white hover:bg-[#3d2a24] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        {submitting ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Send size={18} />
                        )}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {rightTab === 'agenda' && lead && (
                <div className="flex-1 overflow-y-auto p-6 min-h-0">
                  <LeadDetailAgendaTab lead={lead} tenantId={tenantId} projects={projects} />
                </div>
              )}

              {rightTab === 'showroom' && lead && (
                <div className="flex-1 overflow-y-auto p-6 min-h-0">
                  <LeadDetailShowroomTab lead={lead} tenantId={tenantId} projects={projects} />
                </div>
              )}
            </div>
          </div>
        ) : null}

      </div>
    </div>,
    document.body
  )
}
