'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { StoryBoard } from './LaviletStory'

const HEADER_OFFSET_PX = 72

export function HomeTourSection({
  embedded = false,
  scrollToShowroom = false,
  tourHref = '/tour',
}: {
  embedded?: boolean
  scrollToShowroom?: boolean
  tourHref?: string
}) {
  const titleRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    if (!scrollToShowroom) return
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const scrollToTitle = () => {
      const node = titleRef.current
      if (!node) return
      const top = node.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET_PX
      window.scrollTo({ top: Math.max(0, top), behavior: 'auto' })
    }

    scrollToTitle()
    const t1 = window.setTimeout(scrollToTitle, 50)
    const t2 = window.setTimeout(scrollToTitle, 300)
    const t3 = window.setTimeout(scrollToTitle, 800)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearTimeout(t3)
    }
  }, [scrollToShowroom])

  return (
    <section
      id="showroom"
      className={cn(
        'relative z-20',
        scrollToShowroom
          ? 'pt-3 pb-16 sm:pt-4 sm:pb-20 lg:pb-28'
          : embedded
            ? 'py-16 lg:py-24'
            : 'pt-24 pb-16 sm:pt-28 sm:pb-20 lg:pb-28',
      )}
    >
      <p ref={titleRef} className="sr-only">
        Tour virtual
      </p>
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12">
        <StoryBoard
          eyebrow="Tour virtual"
          heading={
            <>
              recorre el
              <span className="block">showroom en 360°</span>
            </>
          }
          featured={{
            src: '/lavilet-sala.jpg',
            alt: 'Sala de un departamento La Vilet',
            object: 'object-center',
            stepped: true,
          }}
          promo={{
            title: 'Entra al espacio',
            body: 'Recorre las suites, cambia de ambiente y mira los pisos en pantalla completa.',
            href: tourHref,
            cta: 'Abrir showroom 360°',
          }}
          cards={[
            {
              src: '/lavilet-comedor.jpg',
              alt: 'Comedor de un departamento La Vilet',
              title: 'La mesa, frente al paisaje',
            },
          ]}
        />
      </div>
    </section>
  )
}
