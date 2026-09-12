'use client'

import { useEffect, useState } from 'react'
import { Landmark, Calculator, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  identifyTourLead,
  openTourSession,
} from '@/lib/tour/visitorTracking'
import {
  getShowroomPhone,
  normalizeShowroomPhone,
} from '@/lib/tour/showroomIdentity'
import { cn } from '@/lib/utils'

export type TourPhoneUnlockIntent = 'simulator' | 'financing'

type TourPhoneUnlockModalProps = {
  open: boolean
  intent: TourPhoneUnlockIntent
  onClose: () => void
  onUnlocked: (intent: TourPhoneUnlockIntent) => void
  contained?: boolean
  typologyCode?: string | null
  unitTypeId?: string | null
  unitId?: string | null
  unitNumber?: string | null
  finish?: string | null
  light?: string | null
}

const COPY: Record<
  TourPhoneUnlockIntent,
  { title: string; line: string; cta: string; Icon: typeof Calculator }
> = {
  simulator: {
    title: 'Simular inversión',
    line: 'Deje su WhatsApp para abrir el simulador de esta unidad.',
    cta: 'Abrir simulador',
    Icon: Calculator,
  },
  financing: {
    title: 'Financiamiento',
    line: 'Deje su WhatsApp para estimar su cuota de crédito.',
    cta: 'Ver financiamiento',
    Icon: Landmark,
  },
}

export function TourPhoneUnlockModal({
  open,
  intent,
  onClose,
  onUnlocked,
  contained = false,
  typologyCode,
  unitTypeId,
  unitId,
  unitNumber,
  finish,
  light,
}: TourPhoneUnlockModalProps) {
  const [pending, setPending] = useState(false)
  const [phone, setPhone] = useState('')
  const copy = COPY[intent]
  const Icon = copy.Icon

  useEffect(() => {
    if (!open) return
    setPending(false)
    setPhone(getShowroomPhone())
  }, [open])

  if (!open) return null

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const normalized = normalizeShowroomPhone(phone)
    if (normalized.replace(/\D/g, '').length < 8) {
      toast.error('Ingrese un celular válido')
      return
    }
    setPending(true)
    try {
      await openTourSession()
      await identifyTourLead({
        mode: 'phone',
        phone: normalized,
        consent: true,
        typology_code: typologyCode || null,
        unit_type_id: unitTypeId || null,
        unit_id: unitId || null,
        unit_number: unitNumber || null,
        finish: finish || null,
        light: light || null,
      })
      onUnlocked(intent)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar el contacto')
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className={cn(
        'z-[85] flex items-end justify-center p-3 sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="relative z-[1] w-full max-w-[20.5rem] overflow-hidden rounded-2xl border border-white/20 bg-[#14110e]/92 p-4 text-[#f7f3ee] shadow-[0_24px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-5"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/10">
              <Icon size={15} strokeWidth={1.75} />
            </div>
            <p className="text-[10px] font-semibold tracking-[0.18em] text-[#BDA27E] uppercase">
              {copy.title}
            </p>
            <p className="mt-1.5 text-sm leading-snug text-[#f7f3ee]/90">{copy.line}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#f7f3ee]/70 hover:bg-white/10 hover:text-white"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        <label className="block text-[11px] font-medium tracking-[0.08em] text-[#f7f3ee]/75 uppercase">
          WhatsApp
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            autoFocus
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="09…"
            className="mt-1.5 h-11 w-full rounded-xl border border-white/15 bg-white/8 px-3 text-sm font-medium tracking-normal text-[#f7f3ee] outline-none placeholder:text-[#f7f3ee]/35 focus:border-[#BDA27E]/70"
          />
        </label>
        <p className="mt-2 text-[11px] leading-snug text-[#f7f3ee]/55">
          Solo para enviarle esta cotización y seguir su visita en el showroom.
        </p>

        <button
          type="submit"
          disabled={pending}
          className="mt-4 flex h-11 w-full items-center justify-center rounded-full bg-[#f7f3ee] text-[11px] font-semibold tracking-[0.12em] text-[#14110e] uppercase disabled:opacity-60"
        >
          {pending ? 'Un momento…' : copy.cta}
        </button>
      </form>
    </div>
  )
}
