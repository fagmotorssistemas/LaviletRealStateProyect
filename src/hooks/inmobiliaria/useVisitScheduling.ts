'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VisitSchedulingOptions } from '@/types/inmobiliaria'
import { getVisitSchedulingOptions } from '@/services/inmobiliaria.service'

export function useVisitScheduling(supabase: SupabaseClient, requestId?: string) {
  const [options, setOptions] = useState<VisitSchedulingOptions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const sequence = useRef(0)
  const reload = useCallback(async (day?: string) => {
    if (!requestId) return
    const current = ++sequence.current
    setLoading(true)
    setError('')
    try {
      const data = await getVisitSchedulingOptions(supabase, requestId, day)
      if (current === sequence.current) setOptions(data)
    } catch {
      if (current === sequence.current) {
        setOptions(null)
        setError('No se pudo comprobar la disponibilidad. Actualiza la solicitud e inténtalo de nuevo.')
      }
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [supabase, requestId])
  useEffect(() => {
    const guard = sequence
    setOptions(null)
    setError('')
    setLoading(false)
    void reload()
    return () => { guard.current++ }
  }, [reload])
  return { options: options?.request_id === requestId ? options : null, loading, error, reload }
}
