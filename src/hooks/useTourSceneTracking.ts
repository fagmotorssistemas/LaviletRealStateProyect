'use client'

import { useEffect, useRef, useState } from 'react'
import { logTourEvent, openTourSession } from '@/lib/tour/visitorTracking'

type SceneTarget = {
  room: string
  roomLabel?: string
  typologyCode: string
  unitTypeId?: string | null
  finish?: string
  light?: string
}

const GATE_SECONDS = 40

export function useTourSceneTracking(target: SceneTarget, options?: { pauseGateClock?: boolean }) {
  const targetRef = useRef(target)
  const startedRef = useRef(Date.now())
  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const roomsRef = useRef(new Set<string>())
  const sceneNudgeRef = useRef(false)
  const [uniqueScenes, setUniqueScenes] = useState(0)
  const [activeSeconds, setActiveSeconds] = useState(0)
  const [gateSeconds, setGateSeconds] = useState(0)
  const [ready, setReady] = useState(false)
  const [identified, setIdentified] = useState(false)
  const pauseGateClock = options?.pauseGateClock ?? false

  useEffect(() => {
    let cancelled = false
    void openTourSession().then((ids) => {
      if (!cancelled && ids) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready || !target.room) return
    const previous = targetRef.current
    const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
    if (previous.room && previous.room !== target.room && elapsed > 0) {
      logTourEvent({
        event_type: 'ambiente',
        room: previous.roomLabel || previous.room,
        typology_code: previous.typologyCode,
        unit_type_id: previous.unitTypeId,
        finish: previous.finish,
        light: previous.light,
        seconds: elapsed,
      })
      setActiveSeconds((value) => value + elapsed)
    }
    if (!roomsRef.current.has(target.room)) {
      roomsRef.current.add(target.room)
      setUniqueScenes(roomsRef.current.size)
      logTourEvent({
        event_type: 'entrada',
        room: target.roomLabel || target.room,
        typology_code: target.typologyCode,
        unit_type_id: target.unitTypeId,
        finish: target.finish,
        light: target.light,
      })
    }
    targetRef.current = target
    startedRef.current = Date.now()
  }, [ready, target.room, target.roomLabel, target.typologyCode, target.unitTypeId, target.finish, target.light])

  useEffect(() => {
    if (!ready) return
    const flush = (eventType: 'ambiente' | 'salida') => {
      if (!visibleRef.current && eventType === 'ambiente') return
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
      if (elapsed < 1 || !targetRef.current.room) return
      logTourEvent(
        {
          event_type: eventType,
          room: targetRef.current.roomLabel || targetRef.current.room,
          typology_code: targetRef.current.typologyCode,
          unit_type_id: targetRef.current.unitTypeId,
          finish: targetRef.current.finish,
          light: targetRef.current.light,
          seconds: elapsed,
        },
        { beacon: true },
      )
      if (eventType === 'ambiente' || eventType === 'salida') {
        setActiveSeconds((value) => value + elapsed)
      }
      startedRef.current = Date.now()
    }

    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      if (!visible && visibleRef.current) flush('salida')
      visibleRef.current = visible
      if (visible) startedRef.current = Date.now()
    }

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      flush('salida')
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ready])

  useEffect(() => {
    if (!ready || !target.room || identified || pauseGateClock) return
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setGateSeconds((value) => value + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [ready, target.room, identified, pauseGateClock])

  useEffect(() => {
    if (sceneNudgeRef.current || uniqueScenes < 3) return
    sceneNudgeRef.current = true
    setGateSeconds((value) => Math.max(value, GATE_SECONDS))
  }, [uniqueScenes])

  return {
    ready,
    uniqueScenes,
    activeSeconds,
    shouldOfferGate: ready && !identified && gateSeconds >= GATE_SECONDS,
    identified,
    markIdentified: () => setIdentified(true),
    snoozeGate: () => setGateSeconds(0),
    lastTypology: target.typologyCode,
    lastUnitTypeId: target.unitTypeId ?? null,
  }
}
