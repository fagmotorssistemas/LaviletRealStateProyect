'use client'

import { ParallaxPhoto } from './ParallaxPhoto'

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
  return (
    <ParallaxPhoto src={src} alt={alt} strength={strength / 2} className={className} imageClassName={imageClassName} sizes={sizes} priority={priority} />
  )
}
