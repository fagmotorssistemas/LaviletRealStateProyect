'use client'

import { useEffect, useRef } from 'react'
import { sendTourDwell } from '@/lib/tour/trackDwell'

type DwellTarget = {
  typologyCode: string
  room: string
  roomLabel?: string
  unitId?: string
  unitCode?: string
}

export function useTourDwellTracking(target: DwellTarget) {
  const targetRef = useRef(target)
  const startedRef = useRef(Date.now())

  useEffect(() => {
    const previous = targetRef.current
    const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
    if (previous.room || previous.typologyCode) {
      sendTourDwell({ ...previous, seconds: elapsed })
    }
    targetRef.current = target
    startedRef.current = Date.now()
  }, [target.typologyCode, target.room, target.roomLabel, target.unitId, target.unitCode])

  useEffect(() => {
    const flush = () => {
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
      sendTourDwell({ ...targetRef.current, seconds: elapsed })
      startedRef.current = Date.now()
    }
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      flush()
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [])
}
