'use client'

import { useEffect, useRef, useState } from 'react'

export type DualSlot = 'a' | 'b'

/**
 * Dos imágenes fijas. La siguiente se decodifica en el buffer oculto
 * y solo entonces intercambia la opacidad.
 */
export function useDualBuffer(src: string | null) {
  const aRef = useRef<HTMLImageElement>(null)
  const bRef = useRef<HTMLImageElement>(null)
  const slot = useRef<DualSlot>('a')
  const shown = useRef<string | null>(src)
  const [front, setFront] = useState<DualSlot>('a')
  const [assigned, setAssigned] = useState<{ a: string | null; b: string | null }>({
    a: src,
    b: null,
  })

  useEffect(() => {
    if (!src || shown.current === src) return
    let cancel = false
    const target: DualSlot = shown.current == null ? 'a' : slot.current === 'a' ? 'b' : 'a'
    setAssigned((prev) => (prev[target] === src ? prev : { ...prev, [target]: src }))

    const run = async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve())
      })
      if (cancel) return
      const img = target === 'a' ? aRef.current : bRef.current
      if (img) {
        if (img.getAttribute('src') !== src) img.src = src
        try {
          await img.decode()
        } catch {
          /* el frame igual se pinta si el elemento sigue montado */
        }
      }
      if (cancel) return
      shown.current = src
      slot.current = target
      setFront(target)
    }
    void run()
    return () => {
      cancel = true
    }
  }, [src])

  return { aRef, bRef, front, assigned }
}
