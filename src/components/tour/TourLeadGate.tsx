'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
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
    <div className="absolute inset-x-0 bottom-0 z-30 flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md rounded-2xl bg-white/95 p-4 shadow-[0_16px_40px_rgba(0,0,0,0.28)] ring-1 ring-black/10 backdrop-blur-sm"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium tracking-[0.18em] text-[#BDA27E] uppercase">Showroom Lavilet</p>
            <p className="mt-1 text-sm leading-relaxed text-[#2B1A18]">
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
            className="text-xs font-medium text-[#2B1A18]/45 hover:text-[#2B1A18]"
          >
            Seguir viendo
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input id="gate-name" name="name" label="Nombre" required autoComplete="name" />
          <Input id="gate-phone" name="phone" label="WhatsApp" type="tel" required autoComplete="tel" />
        </div>
        <div className="mt-2">
          <Input id="gate-email" name="email" label="Correo" type="email" required autoComplete="email" />
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[#2B1A18]/65">
          <input
            id="gate-consent"
            name="consent"
            type="checkbox"
            checked={consented}
            onChange={(event) => setConsented(event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#BDA27E]"
          />
          <span>
            Autorizo que La Vilet me contacte con información del proyecto y que mi recorrido en este
            sitio se asocie a mis datos. He leído la{' '}
            <a href="/privacidad" className="underline decoration-[#2B1A18]/25 underline-offset-2 hover:text-[#2B1A18]">
              política de privacidad
            </a>
            .
          </span>
        </label>
        <Button type="submit" variant="gold" className="mt-3 h-10 w-full" disabled={pending || !consented}>
          {pending ? 'Enviando…' : 'Enviar WhatsApp'}
        </Button>
      </form>
    </div>
  )
}
