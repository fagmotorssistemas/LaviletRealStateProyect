'use client'

import { useEffect, useState, type RefObject } from 'react'

/** Start fetching offscreen media shortly before its section enters view. */
export function useNearViewport(ref: RefObject<Element | null>) {
  const [near, setNear] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setNear(true)
      observer.disconnect()
    }, { rootMargin: '600px' })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])

  return near
}
