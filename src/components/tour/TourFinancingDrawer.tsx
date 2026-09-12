'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, Landmark, X } from 'lucide-react'
import { quoteTotals } from '@/lib/inmobiliaria/financingQuote'
import { formatCurrency, cn } from '@/lib/utils'
import type { FinancingPartner } from '@/types/financingSimulator'
import type { TourUnitSummary } from '@/types/tour'
import './tour-viewer.css'

type TourFinancingDrawerProps = {
  open: boolean
  onClose: () => void
  unitNumber: string | null
  units: TourUnitSummary[]
  onSelectUnit?: (unit: TourUnitSummary) => void
  contained?: boolean
}

type BootstrapPayload = {
  partners?: FinancingPartner[]
  unit?: {
    unit_number?: string | null
    published_commercial_price?: number | null
  } | null
}

const TYPE_OPTIONS = [
  { value: 'banco', label: 'Banco' },
  { value: 'biess', label: 'BIESS' },
  { value: 'cooperativa', label: 'Cooperativa' },
] as const

function unitPriceOf(unit: TourUnitSummary | undefined | null, bootstrapPrice?: number | null) {
  const fromUnit = Number(unit?.published_commercial_price)
  if (Number.isFinite(fromUnit) && fromUnit > 0) return fromUnit
  const fromBoot = Number(bootstrapPrice)
  if (Number.isFinite(fromBoot) && fromBoot > 0) return fromBoot
  return 0
}

function partnerMatchesType(partner: FinancingPartner, type: string) {
  const pt = (partner.partner_type || '').trim().toLowerCase()
  if (!pt) return false
  if (pt === type) return true
  if (type === 'banco') return pt.includes('banco') || pt === 'bank'
  if (type === 'cooperativa') return pt.includes('coop')
  if (type === 'biess') return pt.includes('biess')
  return pt.includes(type)
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** Cotización de crédito al cliente (panel lateral, estilo ficha / simulador). */
export function TourFinancingDrawer({
  open,
  onClose,
  unitNumber,
  units,
  onSelectUnit,
  contained = false,
}: TourFinancingDrawerProps) {
  const reduceMotion = useReducedMotion()
  const [picking, setPicking] = useState(false)
  const [localUnit, setLocalUnit] = useState(unitNumber?.trim() || '')
  const [loading, setLoading] = useState(false)
  const [partners, setPartners] = useState<FinancingPartner[]>([])
  const [bootPrice, setBootPrice] = useState<number | null>(null)
  const [financingType, setFinancingType] = useState<string>('banco')
  const [partnerId, setPartnerId] = useState('')
  const [entryPct, setEntryPct] = useState(30)
  const [termMonths, setTermMonths] = useState(180)
  const [rate, setRate] = useState(10.5)

  const sortedUnits = useMemo(
    () =>
      [...units].sort((a, b) =>
        a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
      ),
    [units],
  )

  const selected = sortedUnits.find((u) => u.unit_number === localUnit)
  const unitPrice = unitPriceOf(selected, bootPrice)

  const filteredPartners = useMemo(
    () => partners.filter((p) => p.active !== false && partnerMatchesType(p, financingType)),
    [partners, financingType],
  )

  const selectedPartner = filteredPartners.find((p) => p.id === partnerId) ?? null

  const quote = useMemo(() => {
    const entryAmount = unitPrice > 0 ? round2((unitPrice * entryPct) / 100) : 0
    return quoteTotals({
      unitPrice,
      entryAmount,
      annualRatePct: rate,
      termMonths,
    })
  }, [unitPrice, entryPct, rate, termMonths])

  useEffect(() => {
    if (!open) {
      setPicking(false)
      return
    }
    const next = unitNumber?.trim() || ''
    setLocalUnit(next)
    setPicking(!next && sortedUnits.length > 0)
  }, [open, unitNumber, sortedUnits.length])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !localUnit.trim()) {
      setPartners([])
      setBootPrice(null)
      return
    }
    let cancelled = false
    setLoading(true)
    void fetch(`/api/financing/bootstrap?unit=${encodeURIComponent(localUnit.trim())}`)
      .then(async (res) => {
        const json = (await res.json()) as BootstrapPayload & { error?: string }
        if (!res.ok) throw new Error(json.error || 'No se pudo cargar')
        if (cancelled) return
        const list = Array.isArray(json.partners) ? json.partners : []
        setPartners(list)
        const price = Number(json.unit?.published_commercial_price)
        setBootPrice(Number.isFinite(price) && price > 0 ? price : null)
      })
      .catch(() => {
        if (!cancelled) {
          setPartners([])
          setBootPrice(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, localUnit])

  useEffect(() => {
    if (!filteredPartners.length) {
      setPartnerId('')
      return
    }
    const keep = filteredPartners.some((p) => p.id === partnerId)
    if (keep) return
    const recommended =
      filteredPartners.find((p) => p.is_recommended) ?? filteredPartners[0]
    setPartnerId(recommended.id)
    if (recommended.annual_interest_rate != null) {
      setRate(Number(recommended.annual_interest_rate) || rate)
    }
    if (recommended.max_financing_years != null && recommended.max_financing_years > 0) {
      setTermMonths(recommended.max_financing_years * 12)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar lista filtrada
  }, [filteredPartners, financingType])

  const pickUnit = (unit: TourUnitSummary) => {
    setLocalUnit(unit.unit_number)
    setPicking(false)
    onSelectUnit?.(unit)
  }

  const applyPartner = (id: string) => {
    setPartnerId(id)
    const partner = filteredPartners.find((p) => p.id === id)
    if (!partner) return
    if (partner.annual_interest_rate != null) {
      setRate(Number(partner.annual_interest_rate) || 0)
    }
    if (partner.max_financing_years != null && partner.max_financing_years > 0) {
      setTermMonths(partner.max_financing_years * 12)
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Cerrar financiamiento"
            className={cn(
              'z-[60] bg-black/25',
              contained ? 'absolute inset-0' : 'fixed inset-0',
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Financiamiento"
            className={cn(
              'z-[70] flex flex-col overflow-hidden rounded-2xl bg-[#f7f3ee] shadow-[0_12px_40px_rgba(15,23,42,0.22)]',
              'w-[min(100%-1.25rem,26rem)]',
              contained
                ? cn(
                    'absolute left-3 sm:left-4',
                    'top-3 bottom-3 max-h-[calc(100%-1.5rem)] sm:top-4 sm:bottom-4',
                  )
                : cn(
                    'fixed left-3 sm:left-5',
                    'top-3 bottom-3 max-h-[calc(100dvh-1.5rem)]',
                    'sm:top-5 sm:bottom-5 sm:max-h-[calc(100dvh-2.5rem)]',
                  ),
            )}
            initial={reduceMotion ? false : { x: -28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { x: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2B1A18]/10 bg-white px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Landmark size={15} strokeWidth={1.75} className="shrink-0 text-[#1a2744]" />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold tracking-[0.14em] text-[#1a2744] uppercase">
                    Financiamiento
                  </p>
                  <p className="truncate text-[11px] text-[#8a8176]">
                    {localUnit ? `Unidad ${localUnit}` : 'Elija una unidad'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {localUnit && sortedUnits.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="rounded-lg px-2 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#1a2744] uppercase hover:bg-[#f4f4ef]"
                  >
                    Cambiar
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-[#6b645c] hover:bg-[#f4f4ef] hover:text-[#1a2744]"
                  aria-label="Cerrar"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="tour-ficha-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
              {picking || !localUnit ? (
                <div className="space-y-3">
                  {localUnit ? (
                    <button
                      type="button"
                      onClick={() => setPicking(false)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.1em] text-[#6b645c] uppercase hover:text-[#1a2744]"
                    >
                      <ChevronLeft size={14} />
                      Volver
                    </button>
                  ) : null}
                  <p className="text-sm text-[#6b645c]">
                    {sortedUnits.length > 0
                      ? 'Elija el departamento a financiar:'
                      : 'No hay unidades disponibles en esta tipología.'}
                  </p>
                  <ul className="grid grid-cols-2 gap-2">
                    {sortedUnits.map((unit) => (
                      <li key={unit.id}>
                        <button
                          type="button"
                          onClick={() => pickUnit(unit)}
                          className={cn(
                            'flex w-full flex-col rounded-xl border bg-white px-3 py-3 text-left transition-colors',
                            unit.unit_number === localUnit
                              ? 'border-[#1a2744] ring-1 ring-[#1a2744]/20'
                              : 'border-[#e4ddd3] hover:border-[#BDA27E]/60',
                          )}
                        >
                          <span className="text-base font-semibold text-[#1f1a14]">
                            {unit.unit_number}
                          </span>
                          <span className="text-[11px] text-[#8a8176]">
                            {unitPriceOf(unit) > 0
                              ? formatCurrency(unitPriceOf(unit))
                              : unit.floor
                                ? `Piso ${unit.floor}`
                                : 'Ver cuota'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : loading ? (
                <p className="py-10 text-center text-sm text-[#8a8176]">Cargando condiciones…</p>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[#e4ddd3] bg-white px-3.5 py-3">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                      Precio de la unidad
                    </p>
                    <p className="mt-1 text-2xl font-semibold tracking-tight text-[#1f1a14]">
                      {unitPrice > 0 ? formatCurrency(unitPrice) : 'Sin precio'}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                      Tipo de institución
                    </p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {TYPE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setFinancingType(opt.value)}
                          className={cn(
                            'rounded-lg px-2 py-2 text-[11px] font-semibold tracking-[0.06em] uppercase transition-colors',
                            financingType === opt.value
                              ? 'bg-[#1a2744] text-white'
                              : 'bg-white text-[#6b645c] ring-1 ring-[#e4ddd3]',
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredPartners.length > 0 ? (
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                        Institución
                      </span>
                      <select
                        value={partnerId}
                        onChange={(e) => applyPartner(e.target.value)}
                        className="h-10 w-full rounded-xl border border-[#e4ddd3] bg-white px-3 text-sm text-[#1f1a14] outline-none focus:border-[#BDA27E]"
                      >
                        {filteredPartners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.partner_name}
                            {p.annual_interest_rate != null
                              ? ` · ${p.annual_interest_rate}%`
                              : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="text-xs text-[#8a5c58]">
                      Sin instituciones de este tipo. Ajuste el tipo o use tasa manual.
                    </p>
                  )}

                  <label className="block space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                        Entrada
                      </span>
                      <span className="text-sm font-semibold text-[#1f1a14]">
                        {entryPct}% · {formatCurrency(quote.entryAmount)}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={70}
                      step={1}
                      value={entryPct}
                      onChange={(e) => setEntryPct(Number(e.target.value) || 0)}
                      className="w-full accent-[#1a2744]"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                        Plazo (años)
                      </span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={Math.round(termMonths / 12) || 1}
                        onChange={(e) => {
                          const years = Math.max(1, Number(e.target.value) || 1)
                          setTermMonths(years * 12)
                        }}
                        className="h-10 w-full rounded-xl border border-[#e4ddd3] bg-white px-3 text-sm text-[#1f1a14] outline-none focus:border-[#BDA27E]"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                        Tasa anual %
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={rate}
                        onChange={(e) => setRate(Number(e.target.value) || 0)}
                        className="h-10 w-full rounded-xl border border-[#e4ddd3] bg-white px-3 text-sm text-[#1f1a14] outline-none focus:border-[#BDA27E]"
                      />
                    </label>
                  </div>

                  <div className="space-y-2 rounded-xl border border-[#e4ddd3] bg-white px-3.5 py-3 text-sm">
                    <Row label="Entrada" value={formatCurrency(quote.entryAmount)} />
                    <Row label="Saldo a financiar" value={formatCurrency(quote.financed)} />
                    <Row
                      label="Total intereses (ref.)"
                      value={formatCurrency(quote.totalInterest)}
                    />
                  </div>

                  <div className="rounded-xl bg-[#616857] px-4 py-3.5 text-[#f4f4ef]">
                    <p className="text-[10px] font-semibold tracking-[0.14em] text-white/70 uppercase">
                      Cuota mensual estimada
                    </p>
                    <p className="mt-1 text-2xl font-bold tracking-tight">
                      {formatCurrency(quote.monthly)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/65">
                      {termMonths} meses
                      {selectedPartner ? ` · ${selectedPartner.partner_name}` : ''}
                    </p>
                  </div>

                  <p className="text-[11px] leading-relaxed text-[#8a8176]">
                    Referencial. Sujeto a aprobación de la institución, avalúo y políticas de crédito.
                  </p>
                </div>
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[#8a8176]">{label}</span>
      <span className="font-medium text-[#1f1a14]">{value}</span>
    </div>
  )
}
