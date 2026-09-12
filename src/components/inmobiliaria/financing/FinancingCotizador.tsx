'use client'

import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/AuthContext'
import {
  createLeadFinancingAction,
  createLeadForQuoteAction,
} from '@/app/inmobiliaria/financiamiento/actions'
import { listLeads, listUnits } from '@/services/inmobiliaria.service'
import { formatCurrency } from '@/lib/utils'
import { buildAmortizationSchedule, quoteTotals } from '@/lib/inmobiliaria/financingQuote'
import {
  FINANCING_TYPE_OPTIONS,
  type FinancingPartner,
  type Lead,
  type PaymentPlan,
  type Unit,
} from '@/types/inmobiliaria'
import { toast } from 'sonner'

interface FinancingCotizadorProps {
  tenantId: string
  partners: FinancingPartner[]
  plans: PaymentPlan[]
  onSaved: () => void
}

const NEW_PARTNER = '__nueva__'
const NEW_LEAD = '__nuevo_lead__'

const emptyForm = {
  lead_id: '',
  unit_id: '',
  financing_type: 'banco',
  financing_partner_id: '',
  partner_name: '',
  unit_price: '',
  entry_pct: '30',
  entry_amount: '',
  term_months: '',
  interest_rate: '',
  notes: '',
  new_lead_name: '',
  new_lead_phone: '',
  new_lead_email: '',
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

function unitPriceOf(unit: Unit | undefined | null): number {
  if (!unit) return 0
  const raw = unit.published_commercial_price
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function partnersMatchingType(partners: FinancingPartner[], financingType: string) {
  const type = financingType.trim().toLowerCase()
  const active = partners.filter((p) => p.is_active !== false)
  if (!type || type === 'mixto' || type === 'contado') return active
  return active.filter((p) => {
    const pt = (p.partner_type || '').trim().toLowerCase()
    if (!pt) return false
    if (pt === type) return true
    if (type === 'banco') return pt.includes('banco') || pt === 'bank'
    if (type === 'cooperativa') return pt.includes('coop')
    if (type === 'biess') return pt.includes('biess')
    return pt.includes(type)
  })
}

export function FinancingCotizador({ tenantId, partners, plans: _plans, onSaved }: FinancingCotizadorProps) {
  const { supabase, profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [form, setForm] = useState(emptyForm)
  const [showSchedule, setShowSchedule] = useState(false)
  /** Quién manda: % o $ — el otro se calcula y queda bloqueado. */
  const [entryDriver, setEntryDriver] = useState<'pct' | 'amount'>('pct')

  useEffect(() => {
    if (!tenantId) return
    Promise.all([
      listLeads(supabase, { tenantId, page: 1, pageSize: 200 }),
      listUnits(supabase, { tenantId, page: 1, pageSize: 500, sort: 'unit_natural' }),
    ])
      .then(([leadRes, unitRes]) => {
        setLeads(leadRes.data)
        setUnits(unitRes.data)
      })
      .catch(console.error)
  }, [tenantId, supabase])

  const selectedLead = leads.find((l) => l.id === form.lead_id)
  const selectedUnit = units.find((u) => u.id === form.unit_id)
  const selectedPartner = partners.find((p) => p.id === form.financing_partner_id)
  const creatingLead = form.lead_id === NEW_LEAD

  const filteredPartners = useMemo(
    () => partnersMatchingType(partners, form.financing_type),
    [partners, form.financing_type],
  )

  const quote = useMemo(() => {
    const unitPrice = Number(form.unit_price) || 0
    const entryAmount = Number(form.entry_amount) || 0
    return quoteTotals({
      unitPrice,
      entryAmount,
      annualRatePct: Number(form.interest_rate) || 0,
      termMonths: Number(form.term_months) || 0,
    })
  }, [form.unit_price, form.entry_amount, form.interest_rate, form.term_months])

  const schedule = useMemo(
    () =>
      showSchedule
        ? buildAmortizationSchedule(quote.financed, Number(form.interest_rate) || 0, Number(form.term_months) || 0)
        : [],
    [showSchedule, quote.financed, form.interest_rate, form.term_months],
  )

  const syncEntryFromPrice = (price: number, pct: number, amount: number, driver: 'pct' | 'amount') => {
    if (!(price > 0)) {
      return {
        entry_pct: driver === 'pct' ? String(pct || '') : form.entry_pct,
        entry_amount: driver === 'amount' ? String(amount || '') : form.entry_amount,
      }
    }
    if (driver === 'pct') {
      const safePct = pct || 0
      return {
        entry_pct: String(safePct),
        entry_amount: String(round2((price * safePct) / 100)),
      }
    }
    const safeAmount = amount || 0
    return {
      entry_amount: String(safeAmount),
      entry_pct: String(round2((safeAmount / price) * 100)),
    }
  }

  const handleUnitChange = (unitId: string) => {
    const unit = units.find((u) => u.id === unitId)
    const price = unitPriceOf(unit)
    const pct = Number(form.entry_pct) || 30
    if (unit && !(price > 0)) {
      toast.error(`La unidad ${unit.unit_number} no tiene precio publicado`)
    }
    setEntryDriver('pct')
    setForm((p) => ({
      ...p,
      unit_id: unitId,
      unit_price: price > 0 ? String(price) : '',
      entry_pct: String(pct),
      entry_amount: price > 0 ? String(round2((price * pct) / 100)) : '',
    }))
  }

  const handleTypeChange = (value: string) => {
    const nextPartners = partnersMatchingType(partners, value)
    const keep =
      form.financing_partner_id === NEW_PARTNER ||
      nextPartners.some((p) => p.id === form.financing_partner_id)
    setForm((p) => ({
      ...p,
      financing_type: value,
      financing_partner_id: keep ? p.financing_partner_id : '',
      partner_name: keep && p.financing_partner_id === NEW_PARTNER ? p.partner_name : '',
    }))
  }

  const handlePartnerChange = (value: string) => {
    const partner = partners.find((p) => p.id === value)
    const price = Number(form.unit_price) || 0
    const minPct = partner?.min_entry_pct
    const pct = minPct != null ? minPct : Number(form.entry_pct) || 30
    setEntryDriver('pct')
    setForm((p) => ({
      ...p,
      financing_partner_id: value,
      partner_name: value === NEW_PARTNER ? p.partner_name : '',
      interest_rate: partner?.approx_rate != null ? String(partner.approx_rate) : p.interest_rate,
      term_months: partner?.max_term_years != null ? String(partner.max_term_years * 12) : p.term_months,
      entry_pct: String(pct),
      entry_amount: price > 0 ? String(round2((price * pct) / 100)) : p.entry_amount,
    }))
  }

  const handleEntryPct = (value: string) => {
    setEntryDriver('pct')
    const pct = Number(value) || 0
    const price = Number(form.unit_price) || 0
    setForm((p) => ({
      ...p,
      entry_pct: value,
      entry_amount: price > 0 ? String(round2((price * pct) / 100)) : '',
    }))
  }

  const handleEntryAmount = (value: string) => {
    setEntryDriver('amount')
    const amount = Number(value) || 0
    const price = Number(form.unit_price) || 0
    setForm((p) => ({
      ...p,
      entry_amount: value,
      entry_pct: price > 0 ? String(round2((amount / price) * 100)) : p.entry_pct,
    }))
  }

  const handlePrice = (value: string) => {
    const price = Number(value) || 0
    const pct = Number(form.entry_pct) || 0
    const amount = Number(form.entry_amount) || 0
    const synced = syncEntryFromPrice(price, pct, amount, entryDriver)
    setForm((p) => ({
      ...p,
      unit_price: value,
      ...synced,
    }))
  }

  const resetForm = () => {
    setForm(emptyForm)
    setShowSchedule(false)
    setEntryDriver('pct')
  }

  const persist = async () => {
    let leadId = form.lead_id

    if (creatingLead) {
      const name = form.new_lead_name.trim()
      if (!name) {
        toast.error('Escribe el nombre del nuevo lead')
        return false
      }
      setLoading(true)
      try {
        const lead = await createLeadForQuoteAction({
          name,
          phone: form.new_lead_phone.trim() || null,
          email: form.new_lead_email.trim() || null,
          unit_id: form.unit_id || null,
        })
        leadId = lead.id
        setLeads((prev) => [lead, ...prev])
        setForm((p) => ({
          ...p,
          lead_id: lead.id,
          new_lead_name: '',
          new_lead_phone: '',
          new_lead_email: '',
        }))
        toast.success('Lead creado')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se pudo crear el lead')
        setLoading(false)
        return false
      }
    }

    if (!leadId || leadId === NEW_LEAD) {
      toast.error('Selecciona el solicitante (lead)')
      return false
    }
    const partnerSelected =
      (form.financing_partner_id && form.financing_partner_id !== NEW_PARTNER) ||
      Boolean(form.partner_name.trim())
    if (!partnerSelected) {
      toast.error('Selecciona o escribe la institución financiera')
      return false
    }
    if (!(quote.unitPrice > 0) || !(Number(form.term_months) > 0)) {
      toast.error('Completa precio, entrada y plazo')
      return false
    }

    setLoading(true)
    try {
      await createLeadFinancingAction({
        lead_id: leadId,
        unit_id: form.unit_id || null,
        financing_partner_id:
          form.financing_partner_id && form.financing_partner_id !== NEW_PARTNER
            ? form.financing_partner_id
            : null,
        financing_partner_name:
          form.financing_partner_id === NEW_PARTNER || !form.financing_partner_id
            ? form.partner_name.trim() || null
            : null,
        status: 'simulado',
        financing_type: form.financing_type || null,
        unit_price: quote.unitPrice,
        entry_amount: quote.entryAmount,
        financed_amount: quote.financed,
        term_months: Number(form.term_months) || null,
        interest_rate: Number(form.interest_rate) || null,
        monthly_payment: round2(quote.monthly) || null,
        notes: form.notes.trim() || null,
        generated_by: 'asesor',
      })
      toast.success('Proforma guardada en simulaciones')
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo guardar la proforma')
      return false
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const ok = await persist()
    if (!ok) return
    onSaved()
  }

  const handleSaveAndPrint = async () => {
    const ok = await persist()
    if (!ok) return
    onSaved()
    window.print()
  }

  const issuedAt = new Intl.DateTimeFormat('es-EC', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date())

  const partnerLabel =
    selectedPartner?.name ||
    (form.partner_name.trim() ? form.partner_name.trim() : 'Institución por definir')

  const typeLabel =
    FINANCING_TYPE_OPTIONS.find((o) => o.value === form.financing_type)?.label ?? 'Institución'
  const partnerPlaceholder =
    form.financing_type === 'cooperativa'
      ? 'Cooperativa…'
      : form.financing_type === 'biess'
        ? 'BIESS…'
        : 'Banco…'

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #financing-proforma, #financing-proforma * { visibility: visible !important; }
          #financing-proforma { position: absolute; inset: 0; width: 100%; box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 print:hidden">
        Guarda cada cotización. <span className="font-medium">Guardar e imprimir</span> archiva la
        proforma en el sistema y abre el diálogo de impresión.
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
        <Button type="button" variant="outline" onClick={resetForm}>
          Reiniciar
        </Button>
        <Button type="submit" variant="outline" disabled={loading}>
          {loading ? 'Guardando...' : 'Guardar proforma'}
        </Button>
        <Button type="button" disabled={loading} onClick={handleSaveAndPrint}>
          Guardar e imprimir
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-5 border border-[#c5c8bc] bg-[#f4f4ef] p-3 shadow-[inset_0_0_0_5px_#f4f4ef] print:hidden sm:p-5 lg:col-span-2">
          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a7d55]">
              Unidad del inventario
            </p>
            <Select
              id="fin-unit"
              label="Unidad"
              options={units.map((u) => {
                const price = unitPriceOf(u)
                return {
                  value: u.id,
                  label: `${u.unit_number}${u.project?.name ? ` · ${u.project.name}` : ''}${
                    price > 0 ? ` · ${formatCurrency(price)}` : ''
                  }`,
                }
              })}
              placeholder="Buscar / seleccionar unidad"
              value={form.unit_id}
              onChange={(e) => handleUnitChange(e.target.value)}
            />
            {selectedUnit ? (
              <p className="text-xs text-[#6b645c]">
                Precio publicado:{' '}
                <span className="font-semibold text-[#3a3d36]">
                  {unitPriceOf(selectedUnit) > 0
                    ? formatCurrency(unitPriceOf(selectedUnit))
                    : 'Sin precio en inventario'}
                </span>
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a7d55]">
              Datos del solicitante
            </p>
            <Select
              id="fin-lead"
              label="Lead *"
              options={[
                { value: NEW_LEAD, label: '+ Crear lead nuevo…' },
                ...leads.map((l) => ({
                  value: l.id,
                  label: l.phone ? `${l.name} · ${l.phone}` : l.name,
                })),
              ]}
              placeholder="Nombre del prospecto"
              value={form.lead_id}
              onChange={(e) => setForm((p) => ({ ...p, lead_id: e.target.value }))}
            />
            {creatingLead ? (
              <div className="space-y-3 rounded-lg border border-[#c5c8bc] bg-white/70 p-3">
                <p className="text-xs text-[#6b645c]">
                  Se creará el lead al guardar la proforma.
                </p>
                <Input
                  id="fin-new-lead-name"
                  label="Nombre *"
                  placeholder="Nombre completo"
                  value={form.new_lead_name}
                  onChange={(e) => setForm((p) => ({ ...p, new_lead_name: e.target.value }))}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    id="fin-new-lead-phone"
                    label="Celular"
                    placeholder="09…"
                    value={form.new_lead_phone}
                    onChange={(e) => setForm((p) => ({ ...p, new_lead_phone: e.target.value }))}
                  />
                  <Input
                    id="fin-new-lead-email"
                    label="Email"
                    type="email"
                    placeholder="opcional"
                    value={form.new_lead_email}
                    onChange={(e) => setForm((p) => ({ ...p, new_lead_email: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#9a7d55]">
              Condiciones del crédito
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                id="fin-type"
                label="Tipo"
                options={FINANCING_TYPE_OPTIONS}
                value={form.financing_type}
                onChange={(e) => handleTypeChange(e.target.value)}
              />
              <Select
                id="fin-partner"
                label={`${typeLabel} *`}
                options={[
                  ...filteredPartners.map((p) => ({ value: p.id, label: p.name })),
                  { value: NEW_PARTNER, label: `Otra ${typeLabel.toLowerCase()}…` },
                ]}
                placeholder={partnerPlaceholder}
                value={form.financing_partner_id}
                onChange={(e) => handlePartnerChange(e.target.value)}
              />
            </div>
            {filteredPartners.length === 0 && form.financing_partner_id !== NEW_PARTNER ? (
              <p className="text-xs text-[#8a5c58]">
                No hay {typeLabel.toLowerCase()}s cargados. Elige “Otra…” o cambia el tipo.
              </p>
            ) : null}
            {(form.financing_partner_id === NEW_PARTNER || !form.financing_partner_id) && (
              <Input
                id="fin-partner-name"
                label={`Nombre de la ${typeLabel.toLowerCase()}`}
                placeholder={
                  form.financing_type === 'cooperativa'
                    ? 'Cooperativa JEP'
                    : form.financing_type === 'biess'
                      ? 'BIESS'
                      : 'Banco Pichincha'
                }
                value={form.partner_name}
                onChange={(e) => setForm((p) => ({ ...p, partner_name: e.target.value }))}
              />
            )}
            <Input
              id="fin-price"
              label="Precio de la unidad ($)"
              type="number"
              min="0"
              step="0.01"
              value={form.unit_price}
              onChange={(e) => handlePrice(e.target.value)}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="fin-entry-pct"
                label="Entrada (%)"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={form.entry_pct}
                readOnly={entryDriver === 'amount'}
                className={entryDriver === 'amount' ? 'cursor-pointer bg-[#ebece6] text-[#6b645c]' : undefined}
                onChange={(e) => handleEntryPct(e.target.value)}
                onFocus={() => {
                  setEntryDriver('pct')
                }}
              />
              <Input
                id="fin-entry"
                label="Entrada ($)"
                type="number"
                min="0"
                step="0.01"
                value={form.entry_amount}
                readOnly={entryDriver === 'pct'}
                className={entryDriver === 'pct' ? 'cursor-pointer bg-[#ebece6] text-[#6b645c]' : undefined}
                onChange={(e) => handleEntryAmount(e.target.value)}
                onFocus={() => {
                  setEntryDriver('amount')
                }}
              />
            </div>
            <p className="text-[11px] text-[#8a8d87]">
              {entryDriver === 'pct'
                ? 'Editando %. El $ se calcula solo. Haz clic en Entrada ($) para editar el monto.'
                : 'Editando $. El % se calcula solo. Haz clic en Entrada (%) para editar el porcentaje.'}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id="fin-term"
                label="Plazo (meses)"
                type="number"
                min="1"
                value={form.term_months}
                onChange={(e) => setForm((p) => ({ ...p, term_months: e.target.value }))}
              />
              <Input
                id="fin-rate"
                label="Tasa anual (%)"
                type="number"
                step="0.01"
                value={form.interest_rate}
                onChange={(e) => setForm((p) => ({ ...p, interest_rate: e.target.value }))}
              />
            </div>
          </section>

          <Textarea
            id="fin-notes"
            label="Notas"
            placeholder="Observaciones para el cliente o el banco..."
            value={form.notes}
            onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          />
        </div>

        <div className="lg:col-span-3">
          <div
            id="financing-proforma"
            className="border border-[#c5c8bc] bg-[#f7f7f3] p-6 shadow-[inset_0_0_0_6px_#f4f4ef] print:border-0 print:shadow-none"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/LogoHorizontal.png" alt="Lavilet" className="h-14 w-auto object-contain" />
              <div className="text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Asesor responsable
                </p>
                <p className="text-sm font-semibold text-[#3a3d36]">{profile?.full_name || '—'}</p>
                {profile?.phone && <p className="text-xs text-slate-500">{profile.phone}</p>}
              </div>
            </div>

            <div className="mt-4 flex items-end justify-between">
              <div>
                <h3 className="font-display text-2xl font-semibold text-[#3a3d36]">Proforma de financiamiento</h3>
                <p className="text-xs text-slate-500">{partnerLabel}</p>
              </div>
              <p className="text-xs text-slate-400">{issuedAt}</p>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Solicitante
                </p>
                <p className="mt-1 font-medium text-slate-900">
                  {creatingLead
                    ? form.new_lead_name.trim() || 'Nuevo lead'
                    : (selectedLead?.name ?? '—')}
                </p>
                <p className="text-xs text-slate-500">
                  {creatingLead
                    ? form.new_lead_phone.trim() || 'Sin teléfono'
                    : (selectedLead?.phone ?? 'Sin teléfono')}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Unidad de interés
                </p>
                <p className="mt-1 font-medium text-slate-900">{selectedUnit?.unit_number ?? 'Sin unidad'}</p>
                <p className="text-xs text-slate-500">{selectedUnit?.project?.name ?? '—'}</p>
              </div>
            </div>

            <div className="mt-5 space-y-2 text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Detalle financiero
              </p>
              <Row label="Precio de la unidad" value={formatCurrency(quote.unitPrice)} />
              <Row
                label={`Entrada (${quote.entryPct.toFixed(1)}%)`}
                value={`− ${formatCurrency(quote.entryAmount)}`}
              />
              <Row label="Saldo a financiar" value={formatCurrency(quote.financed)} strong />
            </div>

            <div className="mt-4 space-y-2 rounded-lg border border-slate-100 p-3 text-sm">
              <Row label="Capital" value={formatCurrency(quote.financed)} />
              <Row
                label={`Interés (${form.interest_rate || 0}% anual × ${form.term_months || 0} meses)`}
                value={`+ ${formatCurrency(quote.totalInterest)}`}
              />
              <Row label="Total a pagar" value={formatCurrency(quote.totalPaid)} strong />
            </div>

            <div className="mt-4 border border-[#8b917c] bg-[#616857] px-4 py-3 text-[#f4f4ef]">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-white/70">
                Cuota mensual fija
              </p>
              <p className="crm-num text-2xl font-bold tracking-tight">{formatCurrency(quote.monthly)}</p>
              <p className="text-xs text-white/70">{form.term_months || 0} meses · tabla francesa</p>
            </div>

            <button
              type="button"
              onClick={() => setShowSchedule((v) => !v)}
              className="mt-4 cursor-pointer text-sm font-medium text-[#7a7e70] hover:underline print:hidden"
            >
              {showSchedule ? 'Ocultar cronograma' : 'Ver cronograma de pagos'}
            </button>

            {showSchedule && schedule.length > 0 && (
              <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-100 text-xs">
                <table className="w-full">
                  <thead className="sticky top-0 bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Nº</th>
                      <th className="px-2 py-1.5 text-right font-medium">Cuota</th>
                      <th className="px-2 py-1.5 text-right font-medium">Interés</th>
                      <th className="px-2 py-1.5 text-right font-medium">Capital</th>
                      <th className="px-2 py-1.5 text-right font-medium">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.slice(0, 60).map((row) => (
                      <tr key={row.n} className="border-t border-slate-50">
                        <td className="px-2 py-1">{row.n}</td>
                        <td className="crm-num px-2 py-1 text-right">{formatCurrency(row.payment)}</td>
                        <td className="crm-num px-2 py-1 text-right">{formatCurrency(row.interest)}</td>
                        <td className="crm-num px-2 py-1 text-right">{formatCurrency(row.principal)}</td>
                        <td className="crm-num px-2 py-1 text-right">{formatCurrency(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {schedule.length > 60 && (
                  <p className="px-2 py-1.5 text-slate-400">Mostrando 60 de {schedule.length} cuotas</p>
                )}
              </div>
            )}

            <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
              Proforma referencial. Sujeta a aprobación de la institución, avalúo y políticas de crédito
              vigentes. No constituye oferta vinculante.
            </p>
          </div>
        </div>
      </div>
    </form>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className={strong ? 'crm-num font-semibold text-slate-900' : 'crm-num text-slate-800'}>{value}</span>
    </div>
  )
}
