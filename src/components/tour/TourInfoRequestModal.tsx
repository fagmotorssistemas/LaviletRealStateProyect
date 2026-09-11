'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { toast } from 'sonner'
import { identifyTourLead, logTourEvent } from '@/lib/tour/visitorTracking'
import { cn } from '@/lib/utils'

const MOTIVOS = [
  { value: 'informacion', label: 'Quiero más información' },
  { value: 'visita', label: 'Agendar una visita' },
  { value: 'precio', label: 'Consultar precio / disponibilidad' },
  { value: 'otro', label: 'Otro' },
] as const

const labelClass = 'text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/55 uppercase'

const fieldClass =
  'mt-1.5 h-11 w-full border border-[#2B1A18]/12 bg-white px-3.5 text-[13px] text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 transition-colors focus:border-[#BDA27E] focus:bg-[#f7f3ee]/50'

type TourInfoRequestModalProps = {
  open: boolean
  onClose: () => void
  onIdentified?: () => void
  contained?: boolean
  typologyCode: string
  typologyName?: string | null
  unitNumber?: string | null
  unitId?: string | null
  unitTypeId?: string | null
  floorLabel?: string | null
  finish?: string | null
  light?: string | null
}

export function TourInfoRequestModal({
  open,
  onClose,
  onIdentified,
  contained,
  typologyCode,
  typologyName,
  unitNumber,
  unitId,
  unitTypeId,
  floorLabel,
  finish,
  light,
}: TourInfoRequestModalProps) {
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!open) return
    logTourEvent({
      event_type: 'gate_mostrado',
      typology_code: typologyCode,
      unit_type_id: unitTypeId,
      metadata: { source: 'solicitar_informacion', unit_number: unitNumber ?? null },
    })
  }, [open, typologyCode, unitTypeId, unitNumber])

  if (!open) return null

  const subtitle = [
    unitNumber ? `Unidad ${unitNumber}` : null,
    floorLabel,
    typologyCode,
    typologyName,
  ]
    .filter(Boolean)
    .join(' · ')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (data.get('consent') !== 'on') {
      toast.error('Marcá la casilla de política de privacidad')
      return
    }
    const motivo =
      MOTIVOS.find((item) => item.value === String(data.get('motivo') ?? ''))?.label ||
      'Consulta showroom'
    const mensaje = String(data.get('mensaje') ?? '').trim()

    setPending(true)
    try {
      await identifyTourLead({
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
        phone: String(data.get('phone') ?? ''),
        consent: true,
        typology_code: typologyCode || null,
        unit_type_id: unitTypeId || null,
        unit_id: unitId || null,
        unit_number: unitNumber || null,
        interest_room: mensaje ? `${motivo}: ${mensaje}` : motivo,
        finish: finish || null,
        light: light || null,
      })
      logTourEvent({
        event_type: 'lead_identificado',
        typology_code: typologyCode,
        unit_type_id: unitTypeId,
        metadata: {
          source: 'solicitar_informacion',
          motivo,
          mensaje: mensaje || null,
          unit_number: unitNumber ?? null,
        },
      })
      toast.success('Listo. Te contactaremos a la brevedad.')
      onIdentified?.()
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      toast.error(
        message && !/<!DOCTYPE|<html/i.test(message)
          ? message
          : 'No se pudo enviar. Intentá de nuevo.',
      )
    } finally {
      setPending(false)
    }
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
        aria-label="Cerrar"
        className="absolute inset-0 bg-[#2B1A18]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="relative z-10 m-3 flex max-h-[min(92dvh,720px)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[#f7f3ee] shadow-[0_24px_60px_rgba(43,26,24,0.28)] ring-1 ring-[#2B1A18]/10 sm:m-4"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B1A18]/8 px-5 py-4">
          <Image
            src="/LogoHorizontal.png"
            alt="Lavilet"
            width={120}
            height={28}
            className="h-7 w-auto object-contain"
            priority
          />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center text-[#2B1A18]/55 transition-colors hover:bg-[#2B1A18]/6 hover:text-[#2B1A18]"
            aria-label="Cerrar formulario"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">
            Showroom
          </p>
          <h2 className="mt-2 font-display text-[1.65rem] leading-tight font-semibold tracking-tight text-[#2B1A18]">
            Solicitar información
          </h2>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/55">{subtitle}</p>
          ) : null}

          <div className="mt-6 space-y-3.5">
            <label className="block">
              <span className={labelClass}>Nombre</span>
              <input
                name="name"
                required
                autoComplete="name"
                placeholder="Tu nombre"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Email</span>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="tu@email.com"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Teléfono</span>
              <input
                name="phone"
                type="tel"
                required
                autoComplete="tel"
                placeholder="099 000 0000"
                className={fieldClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Motivo de contacto</span>
              <select
                name="motivo"
                required
                defaultValue="informacion"
                className={cn(fieldClass, 'pr-10')}
              >
                {MOTIVOS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Mensaje</span>
              <textarea
                name="mensaje"
                rows={4}
                placeholder="Contanos qué necesitás o cuándo te gustaría visitar"
                className="mt-1.5 w-full resize-none border border-[#2B1A18]/12 bg-white px-3.5 py-3 text-[13px] text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 transition-colors focus:border-[#BDA27E] focus:bg-[#f7f3ee]/50"
              />
            </label>
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-[12px] leading-snug text-[#2B1A18]/60">
            <input
              name="consent"
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 border-[#2B1A18]/25 accent-[#BDA27E]"
            />
            <span>
              Leí y acepto la{' '}
              <a
                href="/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[#BDA27E]/60 underline-offset-2 hover:text-[#2B1A18]"
              >
                Política de privacidad
              </a>
            </span>
          </label>
        </div>

        <div className="shrink-0 border-t border-[#2B1A18]/8 bg-[#f7f3ee] p-4">
          <button
            type="submit"
            disabled={pending}
            className="flex h-11 w-full items-center justify-center bg-[#BDA27E] text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e] disabled:opacity-60"
          >
            {pending ? 'Enviando…' : 'Enviar'}
          </button>
        </div>
      </form>
    </div>
  )
}
