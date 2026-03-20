'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Phone, Mail, DollarSign, CreditCard, MessageSquare,
  Edit3, Loader2, CheckCircle2, Building2, Send, Plus,
  Trash2, Search, ChevronDown,
} from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Select } from '@/components/ui/Select'
import { Spinner } from '@/components/ui/Spinner'
import { LEAD_STATUS_OPTIONS, INTERACTION_TYPE_OPTIONS } from '@/types/inmobiliaria'
import type { Lead, LeadStatus, LeadInteraction, InteractionType, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import {
  getLead, updateLead, updateLeadStatus,
  listLeadInteractions, addLeadInteraction,
  listUnits, addLeadUnit, removeLeadUnit,
} from '@/services/inmobiliaria.service'
import { formatDateTime, formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

interface LeadDetailModalProps {
  leadId: string | null
  isOpen: boolean
  onClose: () => void
  onUpdated: () => void
  tenantId: string
}

export function LeadDetailModal({ leadId, isOpen, onClose, onUpdated, tenantId }: LeadDetailModalProps) {
  const { supabase, user } = useAuth()
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

  // Unit search
  const [unitSearchOpen, setUnitSearchOpen] = useState(false)
  const [unitSearchQuery, setUnitSearchQuery] = useState('')
  const [unitSearchResults, setUnitSearchResults] = useState<Unit[]>([])
  const [searchingUnits, setSearchingUnits] = useState(false)
  const unitSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Interaction form
  const [interactionType, setInteractionType] = useState<InteractionType>('seguimiento')
  const [interactionContent, setInteractionContent] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!leadId || !isOpen) return
    setLoading(true)
    Promise.all([
      getLead(supabase, leadId),
      listLeadInteractions(supabase, leadId),
    ]).then(([leadData, interactionsData]) => {
      setLead(leadData)
      setInteractions(interactionsData)
      setResume(leadData.resume || '')
      setBudget(leadData.budget?.toString() || '')
      setWantsFinancing(leadData.financing || false)
    }).finally(() => setLoading(false))
  }, [supabase, leadId, isOpen])

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
      const updated = await getLead(supabase, lead.id)
      setLead(updated)
    } catch {
      toast.error('Error al actualizar')
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

  const handleUnitSearch = (query: string) => {
    setUnitSearchQuery(query)
    if (unitSearchTimerRef.current) clearTimeout(unitSearchTimerRef.current)
    if (!query.trim()) {
      setUnitSearchResults([])
      return
    }
    unitSearchTimerRef.current = setTimeout(async () => {
      setSearchingUnits(true)
      try {
        const { data } = await listUnits(supabase, { tenantId, search: query, pageSize: 20 })
        const existingIds = new Set(lead?.lead_units?.map(lu => lu.unit_id) ?? [])
        setUnitSearchResults(data.filter(u => !existingIds.has(u.id)))
      } catch { /* silent */ }
      setSearchingUnits(false)
    }, 300)
  }

  const handleAddUnit = async (unit: Unit) => {
    if (!lead) return
    try {
      await addLeadUnit(supabase, lead.id, unit.id, lead.lead_units?.length ?? 0)
      const updated = await getLead(supabase, lead.id)
      setLead(updated)
      setUnitSearchQuery('')
      setUnitSearchResults([])
      toast.success('Unidad agregada')
    } catch {
      toast.error('Error al agregar unidad')
    }
  }

  const handleRemoveUnit = async (unitId: string) => {
    if (!lead) return
    try {
      await removeLeadUnit(supabase, lead.id, unitId)
      const updated = await getLead(supabase, lead.id)
      setLead(updated)
      toast.success('Unidad eliminada')
    } catch {
      toast.error('Error al eliminar unidad')
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ring-1 ring-slate-900/5">

        {/* ── HEADER ── */}
        <div className="shrink-0 flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 bg-white">
          {loading || !lead ? (
            <div className="h-6 w-48 rounded bg-slate-100 animate-pulse" />
          ) : (
            <>
              {/* Left: avatar + info */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#2B1A18] text-white text-sm font-bold shrink-0">
                  {lead.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900 truncate">{lead.name}</h2>
                  <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5 flex-wrap">
                    {lead.phone && (
                      <span className="flex items-center gap-1"><Phone size={12} />{lead.phone}</span>
                    )}
                    {lead.email && (
                      <span className="flex items-center gap-1"><Mail size={12} />{lead.email}</span>
                    )}
                    {lead.assigned_profile?.full_name && (
                      <span className="text-slate-400">Asignado: {lead.assigned_profile.full_name}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: status dropdown + close */}
              <div className="flex items-center gap-3 shrink-0">
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
                              ? 'bg-slate-50 font-semibold text-[#2B1A18]'
                              : 'text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                            lead.status === opt.value ? 'bg-[#2B1A18]' : 'bg-slate-300'
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
            <div className="hidden md:block w-1/3 h-full overflow-y-auto border-r border-slate-200 bg-slate-50">
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
                          <Loader2 className="h-3 w-3 animate-spin text-[#BDA27E]" />
                          <span className="text-[10px] text-[#BDA27E]">Guardando...</span>
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
                    className="w-full rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm min-h-[120px] resize-none focus:ring-2 focus:ring-[#BDA27E]/20 outline-none transition-all"
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
                      className="flex items-center gap-1 text-[10px] font-semibold text-[#BDA27E] hover:text-[#a88d6a] cursor-pointer transition-colors uppercase tracking-wider"
                    >
                      <Plus size={12} /> Agregar
                    </button>
                  </div>

                  {/* Search input */}
                  {unitSearchOpen && (
                    <div className="mb-3 relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={unitSearchQuery}
                        onChange={(e) => handleUnitSearch(e.target.value)}
                        placeholder="Buscar unidad por número..."
                        autoFocus
                        className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-[#BDA27E]/30 outline-none transition-all"
                      />
                      {searchingUnits && (
                        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-slate-400" />
                      )}

                      {unitSearchResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                          {unitSearchResults.map((unit) => (
                            <button
                              key={unit.id}
                              onClick={() => handleAddUnit(unit)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 transition-colors cursor-pointer"
                            >
                              <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                              <div className="min-w-0 flex-1 text-left">
                                <span className="font-medium text-slate-700 block truncate">{unit.unit_number}</span>
                                <span className="text-xs text-slate-400">
                                  {unit.project?.name && `${unit.project.name} • `}
                                  {formatCurrency(unit.published_commercial_price)}
                                </span>
                              </div>
                              <StatusBadge status={unit.status} type="unit" className="shrink-0" />
                            </button>
                          ))}
                        </div>
                      )}

                      {unitSearchQuery.trim() && !searchingUnits && unitSearchResults.length === 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-10 p-3">
                          <p className="text-xs text-slate-400 text-center">Sin resultados</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Unit list */}
                  {lead.lead_units && lead.lead_units.length > 0 ? (
                    <div className="space-y-3">
                      {lead.lead_units.map((lu) => (
                        <div key={lu.unit_id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3 group">
                          <div className="p-2 bg-slate-100 rounded-lg">
                            <Building2 className="h-4 w-4 text-slate-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="font-semibold text-sm text-slate-800 block truncate">
                              {lu.unit?.unit_number}
                            </span>
                            <div className="flex items-center gap-2 mt-0.5">
                              {lu.unit?.published_commercial_price && (
                                <span className="text-xs text-slate-500">
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
                    <p className="text-sm text-slate-400 italic bg-white p-3 rounded-xl border border-dashed border-slate-200 text-center">
                      Sin unidades seleccionadas.
                    </p>
                  )}
                </div>

                {/* Detalles Financieros */}
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                      <DollarSign className="h-3 w-3" /> Detalles Financieros
                    </label>
                    {isSavingFinance && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
                  </div>

                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
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
                          className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold text-slate-800 focus:bg-white focus:ring-2 focus:ring-[#BDA27E]/30 outline-none transition-all"
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

            {/* ── RIGHT COLUMN (Bitácora) ── */}
            <div className="w-full md:w-2/3 flex flex-col bg-white h-full overflow-hidden">

              {/* Header */}
              <div className="shrink-0 flex items-center gap-2 border-b border-slate-100 px-6 py-3 bg-white">
                <MessageSquare className="h-4 w-4 text-[#2B1A18]" />
                <span className="text-sm font-semibold text-[#2B1A18]">Bitácora</span>
                {interactions.length > 0 && (
                  <span className="text-xs text-slate-400 ml-1">({interactions.length})</span>
                )}
              </div>

              {/* Timeline */}
              <div className="flex-1 overflow-y-auto p-6">
                {interactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
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
                        <div className="flex-1 bg-slate-50 rounded-xl p-4 border border-slate-100">
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
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 resize-y min-h-[44px] focus:outline-none focus:ring-2 focus:ring-[#BDA27E]/30 focus:border-[#2B1A18] transition-colors"
                    />
                  </div>
                  <button
                    onClick={handleAddInteraction}
                    disabled={submitting || !interactionContent.trim()}
                    className="shrink-0 rounded-lg bg-[#2B1A18] p-2.5 text-white hover:bg-[#3d2a24] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    {submitting ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

      </div>
    </div>,
    document.body
  )
}
