'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
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
      toast.error(error instanceof Error ? error.message : 'No se pudo enviar')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:p-3">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-[22rem] rounded-xl bg-white/95 px-3 py-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.24)] ring-1 ring-black/10 backdrop-blur-sm sm:max-w-sm sm:px-3.5 sm:py-3"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium tracking-[0.16em] text-[#BDA27E] uppercase">
              Showroom Lavilet
            </p>
            <p className="mt-0.5 text-[12px] leading-snug text-[#2B1A18]">
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
            className="shrink-0 pt-0.5 text-[11px] font-medium text-[#2B1A18]/75 hover:text-[#2B1A18]"
          >
            Seguir viendo
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <label className="min-w-0">
            <span className="sr-only">Nombre</span>
            <input
              id="gate-name"
              name="name"
              required
              autoComplete="name"
              placeholder="Nombre"
              className="crm-field h-8 px-2.5 text-[13px]"
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
              className="crm-field h-8 px-2.5 text-[13px]"
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
              className="crm-field h-8 px-2.5 text-[13px]"
            />
          </label>
        </div>

        <label className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-snug text-[#2B1A18]/60">
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

        <Button
          type="submit"
          variant="gold"
          size="sm"
          className="mt-2 h-8 w-full tracking-[0.1em]"
          disabled={pending || !consented}
        >
          {pending ? 'Enviando…' : 'Enviar WhatsApp'}
        </Button>
      </form>
    </div>
  )
}
