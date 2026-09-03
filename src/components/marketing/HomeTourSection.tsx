'use client'

import { useState } from 'react'
import { TourSafeArea } from '@/components/tour/TourSafeArea'
import { useAuth } from '@/contexts/AuthContext'
import { TourAccessModal } from './TourAccessModal'

export function HomeTourSection() {
  const { user, isLoading } = useAuth()
  const [open, setOpen] = useState(false)
  const canTour = Boolean(user)

  return (
    <section id="tour" className="relative z-20 scroll-mt-24 bg-[#f7f3ee] py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Tour virtual</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Recorre el showroom en 360°</h2>
          <p className="mt-4 text-[#2B1A18]/65">
            {canTour
              ? 'Entra a las unidades, cambia de ambiente y recorre cada espacio.'
              : 'Primera vez: deja tus datos. Si ya llenaste el formulario, entra solo con tu celular.'}
          </p>
        </div>

        {isLoading ? (
          <div className="mt-10 h-[min(42vh,360px)] min-h-[220px] rounded-2xl bg-[#2B1A18]/6" />
        ) : canTour ? (
          <div className="mt-10 h-[min(78vh,720px)] min-h-[420px] overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-[#2B1A18]/8">
            <TourSafeArea embedded />
          </div>
        ) : (
          <div className="mt-10 overflow-hidden rounded-2xl bg-[#2B1A18] shadow-sm ring-1 ring-[#2B1A18]/8">
            <div className="flex flex-col items-start justify-between gap-6 px-8 py-10 sm:flex-row sm:items-center sm:px-12">
              <div className="max-w-xl">
                <p className="text-[11px] font-medium tracking-[0.22em] text-[#BDA27E] uppercase">
                  Antes de entrar
                </p>
                <p className="mt-3 text-lg font-semibold text-white">
                  Completa el formulario y abre el showroom
                </p>
                <p className="mt-2 text-sm leading-relaxed text-white/65">
                  Nombre, correo, celular y qué buscas. Si ya viniste, entra otra vez solo con tu celular.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-[#BDA27E] px-6 text-sm font-medium text-[#2B1A18] hover:bg-[#cbb089]"
              >
                Solicitar información
              </button>
            </div>
          </div>
        )}
      </div>

      <TourAccessModal isOpen={open} onClose={() => setOpen(false)} />
    </section>
  )
}
