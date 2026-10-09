'use client'

import Image from 'next/image'
import { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

export function ParallaxImage({
  src,
  alt,
  strength = 12,
  className,
  imageClassName,
  sizes = '100vw',
  priority,
}: {
  src: string
  alt: string
  strength?: number
  className?: string
  /** Recorte extra sobre object-cover. El movimiento sigue siendo solo transform. */
  imageClassName?: string
  sizes?: string
  priority?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [`-${strength}%`, `${strength}%`])

  return (
    <div ref={ref} className={cn('relative overflow-hidden', className)}>
      <motion.div
        className="absolute inset-x-0 -inset-y-[15%] will-change-transform"
        style={{ y: reduce ? 0 : y }}
      >
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className={cn('object-cover', imageClassName)}
        />
      </motion.div>
    </div>
  )
}
