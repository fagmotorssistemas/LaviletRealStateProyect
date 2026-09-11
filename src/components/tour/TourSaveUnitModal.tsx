'use client'

import { useEffect, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  identifyTourLead,
  logTourEvent,
  openTourSession,
} from '@/lib/tour/visitorTracking'
import {
  getShowroomPhone,
  isShowroomIdentified,
  normalizeShowroomPhone,
  setShowroomIdentity,
} from '@/lib/tour/showroomIdentity'
import {
  addTourFavorite,
} from '@/lib/tour/tourFavorites'
import { cn } from '@/lib/utils'

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
  await openTourSession()
  let leadId: string | null = null

  if (!isShowroomIdentified()) {
    const normalized = normalizeShowroomPhone(phone ?? '')
    if (normalized.replace(/\D/g, '').length < 8) {
      throw new Error('Ingresá un celular válido')
    }
    leadId = await identifyTourLead({
      mode: 'phone',
      phone: normalized,
      consent: true,
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

  if (context.unitId && context.unitNumber) {
    addTourFavorite({
      unitId: context.unitId,
      unitNumber: context.unitNumber,
      typologyCode: context.typologyCode || null,
      floor: context.floor ?? null,
    })
  }

  logTourEvent({
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
      phone_tail: (getShowroomPhone() || phone || '').replace(/\D/g, '').slice(-4) || null,
      lead_id: leadId,
    },
  })
}

export function TourSaveUnitModal({
  open,
  onClose,
  context,
  contained = false,
  onIdentified,
}: TourSaveUnitModalProps) {
  const [pending, setPending] = useState(false)
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const alreadyIn = isShowroomIdentified()
  const unitLabel = context.unitNumber
    ? `Unidad ${context.unitNumber}`
    : context.typologyCode || 'esta tipología'

  useEffect(() => {
    if (!open) return
    setPending(false)
    setConsent(false)
    setPhone(getShowroomPhone())
  }, [open])

  if (!open) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!alreadyIn && !consent) {
      toast.error('Marcá la casilla para guardar tu departamento')
      return
    }
    setPending(true)
    try {
      await saveTourUnit(context, alreadyIn ? getShowroomPhone() : phone)
      if (!alreadyIn) onIdentified?.()
      toast.success(
        context.unitNumber
          ? `Guardamos la unidad ${context.unitNumber}`
          : 'Guardamos tu selección',
      )
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        'z-[80] flex items-end justify-center p-3 sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/45"
        onClick={onClose}
      />
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="relative z-[1] w-full max-w-[22rem] rounded-2xl bg-white p-4 shadow-[0_20px_50px_rgba(15,23,42,0.28)] sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#BDA27E] uppercase">
              Guardar departamento
            </p>
            <p className="mt-1 text-sm leading-snug text-[#1a2744]">
              {alreadyIn
                ? `¿Guardamos ${unitLabel} en tu lista?`
                : `Dejanos tu celular para guardar ${unitLabel} y retomar después.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b7280] hover:bg-[#f3f4f6]"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {!alreadyIn ? (
          <>
            <label className="block text-[12px] font-medium text-[#1a2744]">
              Celular / WhatsApp
              <input
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Ej. 595981234567"
                className="mt-1.5 h-11 w-full rounded-xl border border-[#e5e7eb] bg-[#f7f8fa] px-3 text-sm text-[#1a2744] outline-none placeholder:text-[#9ca3af] focus:border-[#BDA27E]"
              />
            </label>
            <label className="mt-3 flex items-start gap-2 text-[11px] leading-snug text-[#4b5563]">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Acepto que usen mi celular para guardar mi selección y contactarme por este
                departamento.
              </span>
            </label>
          </>
        ) : (
          <p className="rounded-xl bg-[#f7f8fa] px-3 py-2.5 text-[12px] text-[#4b5563]">
            Sesión con celular ····{getShowroomPhone().replace(/\D/g, '').slice(-4)}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#14110e] text-[12px] font-semibold tracking-[0.1em] text-white uppercase disabled:opacity-60"
        >
          <Bookmark size={15} strokeWidth={2} />
          {pending ? 'Guardando…' : alreadyIn ? 'Guardar' : 'Guardar con mi celular'}
        </button>
      </form>
    </div>
  )
}
