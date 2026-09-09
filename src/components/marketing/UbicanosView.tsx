'use client'

import dynamic from 'next/dynamic'
import { SITE } from '@/lib/marketing/site'
import type { MarketingProjectLocation } from '@/lib/marketing/projectLocationTypes'
import { NearbyAutoCarousel } from './NearbyAutoCarousel'

const LaviletMap = dynamic(() => import('./LaviletMap').then((m) => m.LaviletMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[420px] items-center justify-center bg-[#ebe4da] text-sm text-[#2B1A18]/40">
      Cargando mapa…
    </div>
  ),
})

function addressLines(project: MarketingProjectLocation | null): string[] {
  if (project?.address) {
    const parts = project.address
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length >= 2) return parts.slice(0, 4)
    return [
      project.address,
      [project.city, project.country].filter(Boolean).join(', ') || SITE.city,
    ]
  }
  return ['Ricardo Darquea Granda y Elena Landívar', 'Cuenca, Ecuador']
}

export function UbicanosView({ project }: { project: MarketingProjectLocation | null }) {
  const lines = addressLines(project)

  return (
    <div className="relative z-20 bg-[#f7f3ee] pt-24 pb-16 sm:pt-28 lg:pb-24">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">

        {/* Cabecera horizontal ─ título enorme a la izquierda, datos a la derecha */}
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-end lg:gap-12">
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Ubícanos</p>
            <h1 className="mt-3 font-serif text-[clamp(3rem,6.5vw,5.5rem)] leading-[0.9] font-normal tracking-tight text-[#2B1A18]/30 uppercase">
              UBICACION
            </h1>
          </div>

          <div className="min-w-0 flex flex-col gap-5 lg:max-w-[34rem] lg:pb-2 xl:max-w-[40rem]">
            <p className="font-display text-[clamp(1.6rem,2.4vw,2.6rem)] leading-[1.12] font-semibold tracking-tight text-[#C45C3E] uppercase">
              {lines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
            {project?.name ? (
              <p className="text-xs font-medium tracking-[0.2em] text-[#2B1A18]/40 uppercase">
                {project.name}
                {project.constructionPhase ? ` · ${project.constructionPhase}` : ''}
              </p>
            ) : null}
          </div>
        </div>

        {/* Mapa */}
        <div className="relative mt-10 overflow-hidden bg-[#ebe4da] ring-1 ring-[#2B1A18]/8 lg:mt-12">
          <div className="relative h-[min(68vh,580px)] min-h-[400px] w-full lg:h-[min(72vh,640px)]">
            <LaviletMap className="absolute inset-0" zoom={16} />
          </div>
          <div className="flex flex-col gap-3 border-t border-[#2B1A18]/10 bg-[#f7f3ee]/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-sm font-semibold text-[#2B1A18]">
                {project?.name || SITE.location.label}
              </p>
              <p className="mt-0.5 text-sm text-[#2B1A18]/55">{lines.join(' · ')}</p>
            </div>
            <a
              href={SITE.location.mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-[#2B1A18] px-5 text-sm font-medium text-white transition-colors hover:bg-[#3d2a24]"
            >
              Ver en Google Maps
            </a>
          </div>
        </div>

        <NearbyAutoCarousel />

        <p className="mt-10 max-w-3xl text-sm leading-relaxed text-[#2B1A18]/55">
          En La Vilet lo cercano es parte del proyecto: el río, el parque lineal y el barrio de Puertas
          del Sol forman un sitio completo. Sales menos porque ya estás donde necesitas estar.
        </p>
      </div>
    </div>
  )
}
