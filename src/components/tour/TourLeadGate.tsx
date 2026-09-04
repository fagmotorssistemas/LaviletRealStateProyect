'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { identifyTourLead, logTourEvent } from '@/lib/tour/visitorTracking'

export function TourLeadGate({
  open,
  typology,
  unitTypeId,
  onClose,
  onIdentified,
}: {
  open: boolean
  typology: string
  unitTypeId?: string | null
  onClose: () => void
  onIdentified: () => void
}) {
  const [pending, setPending] = useState(false)
  const [consented, setConsented] = useState(false)
  const shown = Boolean(typology)

  useEffect(() => {
    if (!open) return
    setConsented(false)
    logTourEvent({ event_type: 'gate_mostrado', typology_code: typology, unit_type_id: unitTypeId })
  }, [open, typology, unitTypeId])

  if (!open) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (data.get('consent') !== 'on') {
      toast.error('Marca la casilla para enviarte planos y disponibilidad')
      return
    }
    setPending(true)
    try {
      await identifyTourLead({
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
        phone: String(data.get('phone') ?? ''),
        consent: true,
      })
      toast.success('Listo. Te escribimos con planos y disponibilidad.')
      onIdentified()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        message && !/<!DOCTYPE|<html|__next_error__/i.test(message)
          ? message
          : 'No se pudo enviar. Intenta de nuevo.',
      )
    } finally {
      setPending(false)
    }
  }

  const field =
    'h-9 w-full border border-[#2B1A18]/12 bg-[#f7f3ee]/70 px-3 text-[13px] text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 focus:border-[#BDA27E]'

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-4">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-[22.5rem] border border-[#BDA27E]/35 bg-[#f7f3ee]/96 px-4 py-3.5 shadow-[0_18px_40px_rgba(20,12,10,0.28)] backdrop-blur-md sm:max-w-sm sm:px-5 sm:py-4"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-medium tracking-[0.26em] text-[#BDA27E] uppercase">
              Showroom Lavilet
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#2B1A18]/88">
              {shown
                ? `Te gustó la tipología ${typology}. Déjanos tu WhatsApp y te enviamos los planos y el precio de las unidades disponibles.`
                : 'Déjanos tu WhatsApp y te enviamos los planos y el precio de las unidades disponibles.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              logTourEvent({ event_type: 'gate_cerrado', typology_code: typology, unit_type_id: unitTypeId })
              onClose()
            }}
            className="shrink-0 pt-0.5 text-[10px] font-medium tracking-[0.14em] text-[#2B1A18]/70 uppercase underline decoration-[#2B1A18]/25 underline-offset-4 hover:text-[#2B1A18]"
          >
            Seguir viendo
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0">
            <span className="sr-only">Nombre</span>
            <input
              id="gate-name"
              name="name"
              required
              autoComplete="name"
              placeholder="Nombre"
              className={field}
            />
          </label>
          <label className="min-w-0">
            <span className="sr-only">WhatsApp</span>
            <input
              id="gate-phone"
              name="phone"
              type="tel"
              required
              autoComplete="tel"
              placeholder="WhatsApp"
              className={field}
            />
          </label>
          <label className="col-span-2 min-w-0">
            <span className="sr-only">Correo</span>
            <input
              id="gate-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="Correo"
              className={field}
            />
          </label>
        </div>

        <label className="mt-2.5 flex items-start gap-2 text-[10px] leading-relaxed text-[#2B1A18]/55">
          <input
            id="gate-consent"
            name="consent"
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
            className="mt-0.5 h-3 w-3 shrink-0 accent-[#BDA27E]"
          />
          <span>
            Autorizo que La Vilet me contacte.{' '}
            <a href="/privacidad" className="underline decoration-[#2B1A18]/25 underline-offset-2 hover:text-[#2B1A18]">
              Privacidad
            </a>
          </span>
        </label>

        <button
          type="submit"
          disabled={pending || !consented}
          className="mt-3 h-10 w-full cursor-pointer bg-[#2B1A18] text-[11px] font-medium tracking-[0.22em] text-[#f7f3ee] uppercase transition-colors hover:bg-[#3d2a24] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Enviando…' : 'Enviar WhatsApp'}
        </button>
      </form>
    </div>
  )
}
