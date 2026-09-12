'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import { listVisitInbox, visitInboxError } from '@/services/visitInbox.service'
import type { VisitInboxItem } from '@/types/inmobiliaria'

const POLL_MS = 25000
const OFFLINE_MESSAGE = 'Sin conexión. Las citas se actualizarán cuando vuelva la conexión.'

export function useVisitInbox() {
  const { supabase, user, profile, isLoading: authLoading } = useAuth()
  const scope = useMemo(
    () => getDataAccessScope(user?.id, profile?.role),
    [user?.id, profile?.role],
  )
  const scopeKey = scope ? `${scope.userId}:${scope.isAdmin}` : ''
  const [state, setState] = useState({
    scopeKey: '', items: [] as VisitInboxItem[], ready: false, loading: false, error: '',
  })
  const reloadRef = useRef<() => Promise<void>>(async () => {})
  const [updatedAt, setUpdatedAt] = useState(0)
  const reload = useCallback(() => reloadRef.current(), [])

  useEffect(() => {
    let disposed = false
    let pending: Promise<void> | null = null
    let controller: AbortController | null = null
    let refreshAfterPending = false
    let lastDiagnostic = ''

    const refresh = (queueAfterPending = false): Promise<void> => {
      if (disposed) return Promise.resolve()
      if (pending) {
        refreshAfterPending ||= queueAfterPending
        return pending
      }
      if (authLoading || !scope) {
        setState({ scopeKey, items: [], ready: !authLoading, loading: false, error: '' })
        return Promise.resolve()
      }
      if (!navigator.onLine) {
        setState(prev => ({
          ...prev, scopeKey, items: prev.scopeKey === scopeKey ? prev.items : [],
          error: OFFLINE_MESSAGE, ready: true, loading: false,
        }))
        return Promise.resolve()
      }

      const request = new AbortController()
      controller = request
      setState(prev => ({
        ...prev, scopeKey, items: prev.scopeKey === scopeKey ? prev.items : [], loading: true,
      }))
      pending = (async () => {
        try {
          const items = await listVisitInbox(supabase, { ...scope, signal: request.signal })
          if (disposed || request.signal.aborted) return
          lastDiagnostic = ''
          setUpdatedAt(Date.now())
          setState({ scopeKey, items, ready: true, loading: false, error: '' })
        } catch (error) {
          if (disposed || request.signal.aborted) return
          const failure = visitInboxError(error)
          setState(prev => ({ ...prev, ready: true, loading: false, error: failure.message }))
          if (failure.diagnostic !== lastDiagnostic) {
            lastDiagnostic = failure.diagnostic
            // Connectivity failures belong in the UI, not the Next error overlay.
            if (failure.connection) console.warn(`[Citas pendientes] ${failure.diagnostic}`)
            else console.error(`[Citas pendientes] ${failure.diagnostic}`)
          }
        } finally {
          pending = null
          controller = null
          if (!disposed && refreshAfterPending) {
            refreshAfterPending = false
            void refresh()
          }
        }
      })()
      return pending
    }

    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const changed = () => { void refresh(true) }
    const offline = () => {
      controller?.abort()
      setState(prev => ({ ...prev, error: OFFLINE_MESSAGE, ready: true, loading: false }))
    }
    reloadRef.current = () => refresh()
    void refresh()
    if (authLoading || !scope) return () => {
      disposed = true
      reloadRef.current = async () => {}
    }

    const interval = window.setInterval(refreshVisible, POLL_MS)
    window.addEventListener('visit-inbox-updated', changed)
    window.addEventListener('focus', refreshVisible)
    window.addEventListener('online', changed)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', refreshVisible)
    const channel = supabase
      .channel(`visit-inbox:${scope.userId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'appointment_reschedule_requests' }, changed)
      .subscribe()
    return () => {
      disposed = true
      controller?.abort()
      reloadRef.current = async () => {}
      window.clearInterval(interval)
      window.removeEventListener('visit-inbox-updated', changed)
      window.removeEventListener('focus', refreshVisible)
      window.removeEventListener('online', changed)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', refreshVisible)
      void supabase.removeChannel(channel)
    }
  }, [authLoading, scope, scopeKey, supabase])

  const current = state.scopeKey === scopeKey && !authLoading
  return {
    items: current ? state.items : [], ready: current && state.ready,
    error: current ? state.error : '', loading: current && state.loading, updatedAt,
    reload, isAdmin: Boolean(scope?.isAdmin), userId: scope?.userId ?? '',
  }
}
