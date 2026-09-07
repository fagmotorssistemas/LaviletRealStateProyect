'use client'

import { useEffect, useRef, useState } from 'react'
import { logTourEvent, openTourSession, pingTourSession } from '@/lib/tour/visitorTracking'
import { dwellSectionKey, isGenericTourSection } from '@/lib/tour/gateCopy'
import { TOUR_PANO_SLUG } from '@/lib/tour/tourRooms'

type SceneTarget = {
  room: string
  roomLabel?: string
  typologyCode: string
  unitTypeId?: string | null
  finish?: string
  light?: string
}

type DwellRow = { seconds: number; label: string; typology: string }

const GATE_SECONDS = 40
const INTEREST_MIN_SECONDS = 8

function addDwell(store: Map<string, DwellRow>, target: SceneTarget, seconds: number) {
  if (seconds < 1 || !target.room) return
  const section = dwellSectionKey(target.room)
  if (!section || section === TOUR_PANO_SLUG) return
  const label = (target.roomLabel || target.room).trim()
  if (isGenericTourSection(label) || isGenericTourSection(section)) return
  const key = `${target.typologyCode || '_'}::${section}`
  const previous = store.get(key)
  store.set(key, {
    seconds: (previous?.seconds ?? 0) + seconds,
    label: previous?.label || label,
    typology: target.typologyCode || previous?.typology || '',
  })
}

function pickInterest(
  store: Map<string, DwellRow>,
  current: SceneTarget,
  startedAt: number,
  fallbackTypology: string,
) {
  const merged = new Map(store)
  addDwell(merged, current, Math.round((Date.now() - startedAt) / 1000))
  const top = [...merged.values()].sort((left, right) => right.seconds - left.seconds)[0]
  if (!top || top.seconds < INTEREST_MIN_SECONDS) {
    return { typology: fallbackTypology, roomLabel: null as string | null }
  }
  return { typology: top.typology || fallbackTypology, roomLabel: top.label }
}

export function useTourSceneTracking(target: SceneTarget, options?: { pauseGateClock?: boolean }) {
  const targetRef = useRef(target)
  const startedRef = useRef(Date.now())
  const visibleRef = useRef(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const roomsRef = useRef(new Set<string>())
  const dwellRef = useRef(new Map<string, DwellRow>())
  const interestRef = useRef<{ typology: string; roomLabel: string | null } | null>(null)
  const sceneNudgeRef = useRef(false)
  const [uniqueScenes, setUniqueScenes] = useState(0)
  const [activeSeconds, setActiveSeconds] = useState(0)
  const [gateSeconds, setGateSeconds] = useState(0)
  const [ready, setReady] = useState(false)
  const [identified, setIdentified] = useState(false)
  const pauseGateClock = options?.pauseGateClock ?? false
  const readyRef = useRef(ready)
  readyRef.current = ready

  useEffect(() => {
    let cancelled = false
    void openTourSession()
      .then((ids) => {
        if (!cancelled && ids) setReady(true)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!ready || !target.room) return
    const previous = targetRef.current
    const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
    const roomChanged = Boolean(previous.room && previous.room !== target.room)
    const typologyChanged = Boolean(target.typologyCode && previous.typologyCode !== target.typologyCode)
    if (roomChanged && elapsed > 0) {
      addDwell(dwellRef.current, previous, elapsed)
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
    const firstVisitToRoom = !roomsRef.current.has(target.room)
    if (firstVisitToRoom) {
      roomsRef.current.add(target.room)
      setUniqueScenes(roomsRef.current.size)
    }
    if (firstVisitToRoom || typologyChanged) {
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
    const flushElapsed = () => {
      if (document.visibilityState !== 'visible' || !visibleRef.current) return
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
      if (elapsed < 1 || !targetRef.current.room) return
      pingTourSession(elapsed, {
        typology_code: targetRef.current.typologyCode,
        unit_type_id: targetRef.current.unitTypeId,
      })
      addDwell(dwellRef.current, targetRef.current, elapsed)
      setActiveSeconds((value) => value + elapsed)
      startedRef.current = Date.now()
    }
    const id = window.setInterval(flushElapsed, 10000)
    return () => {
      flushElapsed()
      window.clearInterval(id)
    }
  }, [ready])

  useEffect(() => {
    if (!pauseGateClock) return
    const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
    if (elapsed < 1 || !targetRef.current.room) return
    pingTourSession(elapsed, {
      typology_code: targetRef.current.typologyCode,
      unit_type_id: targetRef.current.unitTypeId,
    })
    addDwell(dwellRef.current, targetRef.current, elapsed)
    setActiveSeconds((value) => value + elapsed)
    startedRef.current = Date.now()
  }, [pauseGateClock])

  useEffect(() => {
    const flushSalida = (opts?: { unmounting?: boolean }) => {
      if (!readyRef.current) return
      const elapsed = Math.round((Date.now() - startedRef.current) / 1000)
      if (elapsed < 1 || !targetRef.current.room) return
      logTourEvent(
        {
          event_type: 'salida',
          room: targetRef.current.roomLabel || targetRef.current.room,
          typology_code: targetRef.current.typologyCode,
          unit_type_id: targetRef.current.unitTypeId,
          finish: targetRef.current.finish,
          light: targetRef.current.light,
          seconds: elapsed,
        },
        { beacon: true },
      )
      addDwell(dwellRef.current, targetRef.current, elapsed)
      if (!opts?.unmounting) setActiveSeconds((value) => value + elapsed)
      startedRef.current = Date.now()
    }

    const onVisibility = () => {
      const visible = document.visibilityState === 'visible'
      if (!visible && visibleRef.current) flushSalida()
      visibleRef.current = visible
      if (visible) startedRef.current = Date.now()
    }

    const onPageHide = () => {
      if (visibleRef.current) flushSalida()
      visibleRef.current = false
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      if (visibleRef.current && document.visibilityState === 'visible') {
        flushSalida({ unmounting: true })
      }
    }
  }, [])

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

  const shouldOfferGate = ready && !identified && gateSeconds >= GATE_SECONDS

  useEffect(() => {
    if (shouldOfferGate && !interestRef.current) {
      interestRef.current = pickInterest(
        dwellRef.current,
        targetRef.current,
        startedRef.current,
        targetRef.current.typologyCode,
      )
    }
    if (!shouldOfferGate) interestRef.current = null
  }, [shouldOfferGate])

  return {
    ready,
    uniqueScenes,
    activeSeconds,
    shouldOfferGate,
    identified,
    markIdentified: () => setIdentified(true),
    snoozeGate: () => setGateSeconds(0),
    lastTypology: target.typologyCode,
    lastUnitTypeId: target.unitTypeId ?? null,
    interestTypology: interestRef.current?.typology || target.typologyCode,
    interestRoomLabel: interestRef.current?.roomLabel ?? null,
  }
}
