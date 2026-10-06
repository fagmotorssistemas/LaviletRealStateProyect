'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useEffect, useRef, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  identifyTourLead,
  logTourEvent,
  openTourSession,
} from '@/lib/tour/visitorTracking'
import {
  getShowroomLeadId,
  getShowroomPhone,
  isShowroomIdentified,
  normalizeShowroomPhone,
  setShowroomIdentity,
} from '@/lib/tour/showroomIdentity'
import {
  addTourFavorite,
  mergeGuestFavoritesIntoPhone,
} from '@/lib/tour/tourFavorites'
import { captureWishlistAfterSave } from '@/lib/meta/wishlistBrowser'
import { cn } from '@/lib/utils'
import { useShowroomSheet } from '@/components/tour/useShowroomSheet'

export type TourSaveContext = {
  typologyCode: string
  unitTypeId?: string | null
  unitId?: string | null
  unitNumber?: string | null
  roomLabel?: string | null
  floor?: string | null
  finish?: string | null
  light?: string | null
}

type TourSaveUnitModalProps = {
  open: boolean
  onClose: () => void
  context: TourSaveContext
  contained?: boolean
  onIdentified?: () => void
}

export async function saveTourUnit(context: TourSaveContext, phone?: string) {
  const wasIdentified = isShowroomIdentified()
  let normalized = getShowroomPhone()
  let leadId: string | null = getShowroomLeadId() || null

  if (!wasIdentified) {
    normalized = normalizeShowroomPhone(phone ?? '')
    if (normalized.replace(/\D/g, '').length < 8) {
      throw new Error('Ingrese un celular válido')
    }
    setShowroomIdentity(normalized, leadId)
  }

  if (normalized) mergeGuestFavoritesIntoPhone(normalized)

  if (context.unitId && context.unitNumber) {
    addTourFavorite({
      unitId: context.unitId,
      unitNumber: context.unitNumber,
      typologyCode: context.typologyCode || null,
      floor: context.floor ?? null,
    })
  }

  try {
    await openTourSession()
    if (!wasIdentified && normalized) {
      leadId = await identifyTourLead({
        mode: 'phone',
        phone: normalized,
        consent: true,
        request_kind: 'save_unit',
        typology_code: context.typologyCode || null,
        unit_type_id: context.unitTypeId || null,
        interest_room: context.roomLabel || null,
        finish: context.finish || null,
        light: context.light || null,
        unit_id: context.unitId || null,
        unit_number: context.unitNumber || null,
      })
      setShowroomIdentity(normalized, leadId)
    }
    await logTourEvent({
      event_type: 'guardar_unidad',
      typology_code: context.typologyCode || null,
      unit_type_id: context.unitTypeId || null,
      room: context.roomLabel || null,
      finish: context.finish || null,
      light: context.light || null,
      metadata: {
        action: 'save',
        unit_id: context.unitId ?? null,
        unit_number: context.unitNumber ?? null,
        phone_tail: (normalized || phone || '').replace(/\D/g, '').slice(-4) || null,
        lead_id: leadId,
      },
    })
    await captureWishlistAfterSave({
      unitId: context.unitId,
      unitNumber: context.unitNumber,
      typologyCode: context.typologyCode,
      leadId,
    })
  } catch {
    /* La unidad ya quedó en la lista local. */
  }
}

export function TourSaveUnitModal({
  open,
  onClose,
  context,
  contained = false,
  onIdentified,
}: TourSaveUnitModalProps) {
  const { t } = useTourLanguage()
  const sheetRef = useRef<HTMLFormElement>(null)
  useShowroomSheet(open, sheetRef)

  const [pending, setPending] = useState(false)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const closeTimer = useRef<number | null>(null)
  const alreadyIn = isShowroomIdentified()
  const unitLabel = context.unitNumber
    ? `Unidad ${context.unitNumber}`
    : context.typologyCode || 'esta tipología'

  useEffect(() => {
    if (!open) return
    setPending(false)
    setConsent(false)
    setPhone(getShowroomPhone())
    setSaved(false)
    setFormError(null)
    return () => {
      if (closeTimer.current != null) window.clearTimeout(closeTimer.current)
    }
  }, [open])

  if (!open) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!alreadyIn && !consent) {
      const message = t('Marque la casilla para guardar su departamento')
      setFormError(message)
      toast.error(message)
      return
    }
    setPending(true)
    setFormError(null)
    try {
      await saveTourUnit(context, alreadyIn ? getShowroomPhone() : phone)
      if (!alreadyIn) onIdentified?.()
      const message = t(context.unitNumber
        ? `Ya se guardó la unidad ${context.unitNumber}`
        : 'Ya se guardó')
      setSaved(true)
      toast.success(message)
      closeTimer.current = window.setTimeout(() => onClose(), 1600)
    } catch (error) {
      const message = t(error instanceof Error ? error.message : 'No se pudo guardar')
      setFormError(message)
      toast.error(message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        'z-[120] flex items-end justify-center p-3 sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label={t("Cerrar")}
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <form
        ref={sheetRef}
        onSubmit={(event) => void handleSubmit(event)}
        className="tour-modal-sheet relative z-[1] w-full max-w-[22rem] rounded-2xl bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.28)] sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#BDA27E] uppercase">
              {t(" Guardar favorito ")}</p>
            <p className="mt-1 text-sm leading-snug text-[#1a2744]">
              {saved
                ? t(context.unitNumber
                  ? `Ya se guardó la unidad ${context.unitNumber}`
                  : 'Ya se guardó')
                : t(alreadyIn
                  ? `¿Guardamos ${unitLabel} en su lista?`
                  : `Deje su celular y guarde ${unitLabel}. Así accede al simulador de inversión y a opciones de financiamiento.`)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-[#f3f4f6]"
            aria-label={t("Cerrar")}
          >
            <X size={16} />
          </button>
        </div>

        {saved ? (
          <p className="rounded-xl bg-[#f7f3ee] px-3 py-3 text-sm font-semibold text-[#29251e]">
            {t('Ya se guardó. La encuentra en Ver favoritos.')}
          </p>
        ) : !alreadyIn ? (
          <>
            <label className="block text-[12px] font-medium text-[#1a2744]">
              {t(" Celular / WhatsApp ")}<input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder={t("Ej. 0981 234 567")}
                className="mt-1.5 h-11 w-full rounded-xl border border-[#e5e7eb] bg-[#f7f8fa] px-3 text-sm text-[#1a2744] outline-none placeholder:text-[#9ca3af] focus:border-[#BDA27E]"
              />
            </label>
            <p className="mt-2 text-[11px] leading-snug text-[#6b645c]">
              {t(" Con su número guarda favoritos y abre el simulador cuando lo necesite. ")}</p>
            <label className="mt-3 flex items-start gap-2 text-[11px] leading-snug text-[#4b5563]">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                {t(" Acepto el uso de mi celular para guardar mi selección y contactarme por este departamento. ")}</span>
            </label>
          </>
        ) : (
          <div className="space-y-2 rounded-xl bg-[#f7f8fa] px-3 py-2.5">
            <p className="text-[12px] text-[#4b5563]">
              {t(" Celular ····")}{t(getShowroomPhone().replace(/\D/g, '').slice(-4))}
            </p>
            <a
              href="/simulador"
              className="inline-flex text-[12px] font-semibold text-[#1a2744] underline-offset-2 hover:underline"
            >
              {t(" Abrir simulador de inversión → ")}</a>
          </div>
        )}

        {formError ? (
          <p className="mt-3 text-[12px] leading-snug text-[#9b2c2c]">{formError}</p>
        ) : null}

        {saved ? null : (
        <button
          type="submit"
          disabled={pending}
          className="tour-modal-submit mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14110e] text-[12px] font-semibold tracking-[0.1em] text-white uppercase disabled:opacity-60"
        >
          <Bookmark size={15} strokeWidth={2} />
          {t(pending ? 'Guardando…' : alreadyIn ? 'Guardar' : 'Guardar con mi celular')}
        </button>
        )}
      </form>
    </div>
  )
}
