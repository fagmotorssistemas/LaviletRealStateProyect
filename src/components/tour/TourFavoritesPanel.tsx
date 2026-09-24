'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useEffect, useState } from 'react'
import { Heart, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  addTourFavorite,
  listTourFavorites,
  removeTourFavorite,
  upsertFavoritesFromServer,
  type TourFavorite,
} from '@/lib/tour/tourFavorites'
import {
  getShowroomLeadId,
  getShowroomPhone,
  isShowroomIdentified,
  normalizeShowroomPhone,
  setShowroomIdentity,
} from '@/lib/tour/showroomIdentity'
import {
  identifyTourLead,
  logTourEvent,
  openTourSession,
} from '@/lib/tour/visitorTracking'
import { captureWishlistAfterSave } from '@/lib/meta/wishlistBrowser'
import { cn } from '@/lib/utils'

type FavoritesContext = {
  typologyCode?: string | null
  unitTypeId?: string | null
  unitId?: string | null
  unitNumber?: string | null
  floor?: string | null
  roomLabel?: string | null
  finish?: string | null
  light?: string | null
}

type TourFavoritesPanelProps = {
  open: boolean
  onClose: () => void
  onOpenUnit: (favorite: TourFavorite) => void
  contained?: boolean
  onIdentified?: () => void
  /** Unidad/vista actual: se puede agregar al identificarse. */
  context?: FavoritesContext
}

export function TourFavoritesPanel({
  open,
  onClose,
  onOpenUnit,
  contained,
  onIdentified,
  context,
}: TourFavoritesPanelProps) {
  const { t } = useTourLanguage()

  const [items, setItems] = useState<TourFavorite[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [identified, setIdentified] = useState(false)

  const refresh = () => setItems(listTourFavorites())
  const hasCurrentUnit = Boolean(context?.unitId && context?.unitNumber)

  useEffect(() => {
    if (!open) return
    setPending(false)
    setConsent(false)
    setPhone(getShowroomPhone())
    setIdentified(isShowroomIdentified())
    refresh()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onChange = () => refresh()
    window.addEventListener('lv-tour-favorites-changed', onChange)
    return () => window.removeEventListener('lv-tour-favorites-changed', onChange)
  }, [open])

  useEffect(() => {
    if (!open || !identified) return
    let cancelled = false
    setLoading(true)
    const storedPhone = getShowroomPhone()
    const qs = storedPhone ? `?phone=${encodeURIComponent(storedPhone)}` : ''
    void fetch(`/api/tour/favorites${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { favorites?: TourFavorite[] }
        if (cancelled || !json.favorites) return
        upsertFavoritesFromServer(json.favorites, storedPhone || null)
        refresh()
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, identified])

  if (!open) return null

  const remove = (item: TourFavorite) => {
    removeTourFavorite(item.unitId)
    refresh()
    logTourEvent({
      event_type: 'guardar_unidad',
      typology_code: item.typologyCode,
      metadata: {
        action: 'remove',
        unit_id: item.unitId,
        unit_number: item.unitNumber,
        floor: item.floor,
      },
    })
  }

  const handleIdentify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!consent) {
      toast.error(t('Marque la casilla para continuar'))
      return
    }
    const normalized = normalizeShowroomPhone(phone)
    if (normalized.replace(/\D/g, '').length < 8) {
      toast.error(t('Ingrese un celular válido'))
      return
    }

    setPending(true)
    try {
      await openTourSession()
      const leadId = await identifyTourLead({
        mode: 'phone',
        phone: normalized,
        consent: true,
        request_kind: 'save_unit',
        typology_code: context?.typologyCode || null,
        unit_type_id: context?.unitTypeId || null,
        interest_room: context?.roomLabel || null,
        finish: context?.finish || null,
        light: context?.light || null,
        unit_id: context?.unitId || null,
        unit_number: context?.unitNumber || null,
      })
      setShowroomIdentity(normalized, leadId)
      onIdentified?.()

      if (hasCurrentUnit && context?.unitId && context.unitNumber) {
        addTourFavorite({
          unitId: context.unitId,
          unitNumber: context.unitNumber,
          typologyCode: context.typologyCode || null,
          floor: context.floor ?? null,
        })
        logTourEvent({
          event_type: 'guardar_unidad',
          typology_code: context.typologyCode || null,
          unit_type_id: context.unitTypeId || null,
          room: context.roomLabel || null,
          finish: context.finish || null,
          light: context.light || null,
          metadata: {
            action: 'save',
            unit_id: context.unitId,
            unit_number: context.unitNumber,
            phone_tail: normalized.replace(/\D/g, '').slice(-4) || null,
            lead_id: leadId,
            source: 'favorites_gate',
          },
        })
        captureWishlistAfterSave({
          unitId: context.unitId,
          unitNumber: context.unitNumber,
          typologyCode: context.typologyCode,
          leadId,
        })
        toast.success(t(`Guardamos el departamento ${context.unitNumber}`))
      } else {
        toast.success(t('Listo. Ya puede simular su inversión'))
      }

      setIdentified(true)
      refresh()
    } catch (error) {
      toast.error(t(error instanceof Error ? error.message : 'No se pudo verificar el celular'))
    } finally {
      setPending(false)
    }
  }

  const addCurrentUnit = () => {
    if (!hasCurrentUnit || !context?.unitId || !context.unitNumber) return
    addTourFavorite({
      unitId: context.unitId,
      unitNumber: context.unitNumber,
      typologyCode: context.typologyCode || null,
      floor: context.floor ?? null,
    })
    logTourEvent({
      event_type: 'guardar_unidad',
      typology_code: context.typologyCode || null,
      unit_type_id: context.unitTypeId || null,
      room: context.roomLabel || null,
      finish: context.finish || null,
      light: context.light || null,
      metadata: {
        action: 'save',
        unit_id: context.unitId,
        unit_number: context.unitNumber,
        phone_tail: getShowroomPhone().replace(/\D/g, '').slice(-4) || null,
        source: 'favorites_panel',
      },
    })
    captureWishlistAfterSave({
      unitId: context.unitId,
      unitNumber: context.unitNumber,
      typologyCode: context.typologyCode,
      leadId: getShowroomLeadId() || null,
    })
    refresh()
    toast.success(t(`Agregamos el departamento ${context.unitNumber}`))
  }

  return (
    <div
      className={cn(
        'z-[80] flex items-end justify-center sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label={t("Cerrar favoritos")}
        className="absolute inset-0 bg-[#2B1A18]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-10 m-3 flex max-h-[min(88dvh,560px)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[#f7f3ee] shadow-[0_24px_60px_rgba(43,26,24,0.28)] ring-1 ring-[#2B1A18]/10 sm:m-4">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B1A18]/8 px-5 py-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">
              {t(" Showroom ")}</p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#2B1A18]">{t("Favoritos")}</h2>
            <p className="mt-0.5 text-[11px] text-[#2B1A18]/50">{t("Y acceso a financiamiento")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center text-[#2B1A18]/55 hover:text-[#2B1A18]"
            aria-label={t("Cerrar")}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {!identified ? (
          <form onSubmit={(event) => void handleIdentify(event)} className="px-5 py-5">
            <p className="text-[13px] leading-relaxed text-[#2B1A18]/80">
              {t(" Deje su celular para guardar favoritos y acceder al")}{t(' ')}
              <span className="font-medium text-[#2B1A18]">{t("simulador de inversión")}</span> {t(" y a opciones de financiamiento. ")}</p>
            {hasCurrentUnit && context?.unitNumber ? (
              <p className="mt-2 text-[12px] text-[#2B1A18]/55">
                {t(" También podemos agregar el departamento ")}{t(context.unitNumber)} {t(" a su lista. ")}</p>
            ) : null}

            <label className="mt-4 block text-[12px] font-medium text-[#2B1A18]">
              {t(" Celular / WhatsApp ")}<input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t("Ej. 0981 234 567")}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#2B1A18]/12 bg-white px-3 text-sm text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 focus:border-[#BDA27E]"
              />
            </label>

            <label className="mt-3 flex items-start gap-2 text-[11px] leading-snug text-[#2B1A18]/60">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 accent-[#BDA27E]"
              />
              <span>
                {t(" Acepto el uso de mi celular para favoritos, financiamiento y contacto por WhatsApp. ")}</span>
            </label>

            <button
              type="submit"
              disabled={pending}
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14110e] text-[12px] font-semibold tracking-[0.1em] text-white uppercase disabled:opacity-60"
            >
              <Heart size={15} strokeWidth={2} />
              {t(pending
                ? 'Guardando…'
                : hasCurrentUnit
                  ? 'Continuar y guardar'
                  : 'Continuar con mi celular')}
            </button>
          </form>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-4 rounded-2xl border border-[#BDA27E]/35 bg-[#BDA27E]/12 px-3.5 py-3">
              <p className="text-[12px] font-medium text-[#2B1A18]">{t("Financiamiento listo")}</p>
              <p className="mt-1 text-[12px] leading-snug text-[#2B1A18]/70">
                {t(" Calcule su cuota y el retorno de su inversión cuando lo desee. ")}</p>
              <a
                href={
                  items[0]?.unitNumber
                    ? `/simulador?unidad=${encodeURIComponent(items[0].unitNumber)}`
                    : context?.unitNumber
                      ? `/simulador?unidad=${encodeURIComponent(context.unitNumber)}`
                      : '/simulador'
                }
                className="mt-2.5 inline-flex h-9 items-center rounded-full bg-[#1a2744] px-3.5 text-[11px] font-semibold tracking-[0.12em] text-white uppercase no-underline"
              >
                {t(" Simular inversión ")}</a>
            </div>

            <p className="mb-3 text-[12px] leading-relaxed text-[#2B1A18]/55">
              {t(" Celular ····")}{t(getShowroomPhone().replace(/\D/g, '').slice(-4))}
            </p>

            {hasCurrentUnit ? (
              <button
                type="button"
                onClick={addCurrentUnit}
                className="mb-4 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#BDA27E] text-[11px] font-semibold tracking-[0.14em] text-[#2B1A18] uppercase"
              >
                <Heart size={14} strokeWidth={2} />
                {t(" Agregar departamento ")}{t(context?.unitNumber)}
              </button>
            ) : null}

            {loading && items.length === 0 ? (
              <p className="text-sm text-[#2B1A18]/50">{t("Cargando…")}</p>
            ) : null}

            {items.length === 0 && !loading ? (
              <p className="text-sm text-[#2B1A18]/55">
                {t(" Aún no tiene favoritos. Elija un departamento y guárdelo aquí. ")}</p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li
                    key={item.unitId}
                    className="flex items-center gap-2 rounded-xl bg-white p-2.5 ring-1 ring-[#2B1A18]/8"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onOpenUnit(item)
                        onClose()
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block text-[13px] font-semibold text-[#2B1A18]">
                        {t(" Departamento ")}{t(item.unitNumber)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-[#2B1A18]/55">
                        {t([item.typologyCode, item.floor].filter(Boolean).join(' · ') || 'Favorito')}
                      </span>
                    </button>
                    <a
                      href={`/simulador?unidad=${encodeURIComponent(item.unitNumber)}`}
                      className="shrink-0 rounded-full px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#1a2744] uppercase no-underline ring-1 ring-[#1a2744]/20"
                      title={t("Simular inversión")}
                    >
                      {t(" Simular ")}</a>
                    <button
                      type="button"
                      onClick={() => remove(item)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center text-[#8a5c58] hover:bg-[#8a5c58]/10"
                      aria-label={t(`Eliminar departamento ${item.unitNumber}`)}
                      title={t("Eliminar")}
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
