'use client'

import { NEARBY_PLACES } from '@/lib/marketing/nearbyPlaces'

/** Carrusel infinito auto-desplazable de lo cercano. */
export function NearbyAutoCarousel() {
  const items = [...NEARBY_PLACES, ...NEARBY_PLACES]

  return (
    <div className="mt-12 lg:mt-14">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.28em] text-[#BDA27E] uppercase">Alrededor</p>
          <h2 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">Qué queda cerca</h2>
          <p className="mt-2 max-w-xl text-sm text-[#2B1A18]/60">
            Un sitio completo: lo esencial está a pasos, no a media ciudad.
          </p>
        </div>
      </div>

      <div className="nearby-marquee relative mt-6 overflow-hidden">
        <div className="nearby-marquee-track flex w-max gap-4">
          {items.map((place, i) => (
            <article
              key={`${place.id}-${i}`}
              className="w-[min(78vw,18.5rem)] shrink-0 rounded-2xl bg-white p-5 ring-1 ring-[#2B1A18]/8 sm:w-[20rem] sm:p-6"
            >
              <p className="text-[11px] font-medium tracking-[0.18em] text-[#BDA27E] uppercase">
                {place.tag}
              </p>
              <h3 className="mt-3 text-lg font-semibold text-[#2B1A18]">{place.title}</h3>
              <p className="mt-1 text-sm text-[#2B1A18]/45">{place.subtitle}</p>
              <p className="mt-3 text-sm leading-relaxed text-[#2B1A18]/65">{place.body}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
