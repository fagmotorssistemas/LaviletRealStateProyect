'use client'

import { useEffect, type RefObject } from 'react'

/** En horizontal bajo, el formulario cabe en pantalla y sube con el teclado. */
export function useShowroomSheet(open: boolean, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return
    const onFocus = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!target.matches('input, textarea, select')) return
      target.scrollIntoView({ block: 'center' })
    }
    const vv = window.visualViewport
    const sync = () => {
      if (!vv) return
      const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.setProperty('--tour-keyboard', `${keyboard}px`)
    }
    root.addEventListener('focusin', onFocus)
    sync()
    vv?.addEventListener('resize', sync)
    vv?.addEventListener('scroll', sync)
    return () => {
      root.removeEventListener('focusin', onFocus)
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
    }
  }, [open, rootRef])
}
