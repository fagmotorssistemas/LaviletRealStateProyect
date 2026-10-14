'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { gsap, useGSAP } from '@/lib/marketing/gsap'
import { cn } from '@/lib/utils'

type ParallaxPhotoProps = {
  src: string
  alt: string
  className?: string
  imageClassName?: string
  sizes?: string
  priority?: boolean
  strength?: number
}

export function ParallaxPhoto({
  src,
  alt,
  className,
  imageClassName,
  sizes = '100vw',
  priority = false,
  strength = 6,
}: ParallaxPhotoProps) {
  const root = useRef<HTMLDivElement>(null)
  const photo = useRef<HTMLImageElement>(null)

  useGSAP(() => {
    if (!root.current || !photo.current) return
    const match = gsap.matchMedia()
    match.add('(prefers-reduced-motion: no-preference)', () => {
      const travel = window.matchMedia('(pointer: coarse)').matches ? Math.min(strength, 3) : strength
      gsap.fromTo(photo.current,
        { scale: 1.12, yPercent: -travel },
        {
          scale: 1.12,
          yPercent: travel,
          ease: 'none',
          scrollTrigger: {
            trigger: root.current,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      )
    })
    return () => match.revert()
  }, { scope: root, dependencies: [strength] })

  return (
    <div ref={root} className={cn('relative overflow-hidden', className)}>
      <Image
        ref={photo}
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        className={cn('object-cover', imageClassName)}
      />
    </div>
  )
}
