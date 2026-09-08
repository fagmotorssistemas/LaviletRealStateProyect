'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { listVisitInbox } from '@/services/inmobiliaria.service'
import type { VisitInboxItem } from '@/types/inmobiliaria'

const POLL_MS = 25000

export function useVisitInbox() {
  const { supabase, user, profile, isLoading: authLoading } = useAuth()
  const [items, setItems] = useState<VisitInboxItem[]>([])
  const [ready, setReady] = useState(false)
  const scope = useMemo(
    () => getDataAccessScope(user?.id, profile?.role),
    [user?.id, profile?.role],
  )
  const requestId = useRef(0)

  const reload = useCallback(async () => {
    if (authLoading || !user || !scope) {
      setItems([])
      setReady(!authLoading)
      return
    }
    const current = ++requestId.current
    try {
      const next = await listVisitInbox(supabase, {
        isAdmin: scope.isAdmin,
        userId: scope.userId,
      })
      if (current !== requestId.current) return
      setItems(next)
    } catch (error) {
      if (current !== requestId.current) return
      console.error(error)
    } finally {
      if (current === requestId.current) setReady(true)
    }
  }, [authLoading, scope, supabase, user])

  useEffect(() => {
    void reload()
    const interval = window.setInterval(() => {
      void reload()
    }, POLL_MS)
    return () => window.clearInterval(interval)
  }, [reload])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel('visit-inbox')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointment_reschedule_requests' },
        () => {
          void reload()
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [reload, supabase, user])

  return { items, ready, reload, isAdmin: Boolean(scope?.isAdmin), userId: scope?.userId ?? '' }
}
