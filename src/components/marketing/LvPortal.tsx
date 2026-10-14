'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/marketing/gsap'

const PHOTO = 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/fondoooparalavilet.png'

/** Remove this single component from FullLanding to omit the portal experiment. */
export function LvPortal() {
  const root = useRef<HTMLElement>(null)
  const windowPhoto = useRef<HTMLImageElement>(null)
  const outline = useRef<HTMLDivElement>(null)
  const fullPhoto = useRef<HTMLDivElement>(null)
  const title = useRef<HTMLDivElement>(null)
  const titleRule = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (!root.current || !windowPhoto.current || !outline.current || !fullPhoto.current || !title.current || !titleRule.current) return
    const match = gsap.matchMedia()
    match.add('(prefers-reduced-motion: no-preference)', () => {
      const timeline = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: 'top top',
          end: '+=180%',
          pin: true,
          scrub: 0.6,
          invalidateOnRefresh: true,
        },
      })
      timeline
        .to(root.current, { '--lv-mask-size': '480%', duration: 1, ease: 'none' }, 0)
        .to(windowPhoto.current, { scale: 1.05, duration: 1, ease: 'none' }, 0)
        .to(outline.current, { opacity: 0, duration: 0.36, ease: 'none' }, 0.5)
        .to(fullPhoto.current, { opacity: 1, duration: 0.34, ease: 'none' }, 0.66)
        .to(title.current, { opacity: 1, y: 0, duration: 0.25, ease: 'none' }, 0.82)
        .to(titleRule.current, { scaleX: 1, duration: 0.22, ease: 'none' }, 0.86)
    })
    return () => match.revert()
  }, { scope: root })

  return (
    <section ref={root} aria-label="La diferencia está en cómo todo encaja" className="lv-portal relative z-20 h-svh overflow-hidden bg-lv-bg">
      <div ref={fullPhoto} className="lv-portal-full absolute inset-0 opacity-0">
        <Image src={PHOTO} alt="Interior de La Vilet" fill sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-lv-bg/60" aria-hidden />
      </div>
      <div className="lv-portal-window absolute inset-0">
        <Image ref={windowPhoto} src={PHOTO} alt="" fill sizes="100vw" className="object-cover scale-[1.6]" />
      </div>
      <div ref={outline} aria-hidden className="lv-portal-outline pointer-events-none absolute inset-0 bg-lv-bronze" />
      <div ref={title} className="lv-portal-title absolute inset-x-5 bottom-[10svh] text-center text-lv-ink opacity-0 sm:inset-x-10">
        <h2 className="font-display text-[clamp(2.25rem,6vw,5.5rem)] leading-none">La diferencia está en cómo todo encaja.</h2>
        <span ref={titleRule} aria-hidden className="mx-auto mt-6 block h-px w-[120px] scale-x-0 bg-[image:var(--lv-bronze-fade)]" />
      </div>
    </section>
  )
}
