'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { knownRole } from '@/lib/inmobiliaria/roleAccess'
import {
  listAdvisorNotifications,
  markAdvisorNotificationRead,
  markAllAdvisorNotificationsRead,
} from '@/services/advisorNotifications.service'
import type { AdvisorNotification } from '@/types/inmobiliaria'

const POLL_MS = 30_000

function useAdvisorNotificationsState() {
  const { supabase, user, profile, isLoading: authLoading } = useAuth()
  const role = knownRole(profile?.role)
  const enabled = Boolean(user && (role === 'asesor' || role === 'admin'))
  const recipientId = enabled ? user?.id ?? '' : ''
  const [items, setItems] = useState<AdvisorNotification[]>([])
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const reloadRef = useRef<() => Promise<void>>(async () => {})

  const reload = useCallback(() => reloadRef.current(), [])

  useEffect(() => {
    let disposed = false
    let pending: Promise<void> | null = null
    let controller: AbortController | null = null

    const refresh = async () => {
      if (disposed || pending) return pending ?? Promise.resolve()
      if (authLoading || !recipientId) {
        setItems([])
        setReady(!authLoading)
        setLoading(false)
        setError('')
        return
      }
      controller = new AbortController()
      setLoading(true)
      pending = (async () => {
        try {
          const rows = await listAdvisorNotifications(supabase, recipientId, controller?.signal)
          if (disposed || controller?.signal.aborted) return
          setItems(rows)
          setError('')
          setReady(true)
        } catch (cause) {
          if (disposed || controller?.signal.aborted) return
          console.error('No se pudieron cargar las notificaciones del asesor', cause)
          setError('No se pudieron actualizar las notificaciones. Reintentaremos automáticamente.')
          setReady(true)
        } finally {
          if (!disposed) setLoading(false)
          pending = null
          controller = null
        }
      })()
      return pending
    }

    reloadRef.current = refresh
    void refresh()
    if (authLoading || !recipientId) return () => {
      disposed = true
      reloadRef.current = async () => {}
    }

    const visibleRefresh = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(visibleRefresh, POLL_MS)
    window.addEventListener('focus', visibleRefresh)
    document.addEventListener('visibilitychange', visibleRefresh)
    const channel = supabase
      .channel(`advisor-notifications:${recipientId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'advisor_notifications',
          filter: `recipient_id=eq.${recipientId}`,
        },
        () => { void refresh() },
      )
      .subscribe()

    return () => {
      disposed = true
      controller?.abort()
      reloadRef.current = async () => {}
      window.clearInterval(interval)
      window.removeEventListener('focus', visibleRefresh)
      document.removeEventListener('visibilitychange', visibleRefresh)
      void supabase.removeChannel(channel)
    }
  }, [authLoading, recipientId, supabase])

  const markRead = useCallback(async (id: string) => {
    if (!recipientId) return
    const readAt = new Date().toISOString()
    setItems(current => current.map(item => item.id === id && !item.read_at ? { ...item, read_at: readAt } : item))
    try {
      await markAdvisorNotificationRead(supabase, recipientId, id)
    } catch (cause) {
      console.error('No se pudo marcar la notificación como leída', cause)
      await reload()
    }
  }, [recipientId, reload, supabase])

  const markAllRead = useCallback(async () => {
    if (!recipientId) return
    const readAt = new Date().toISOString()
    setItems(current => current.map(item => item.read_at ? item : { ...item, read_at: readAt }))
    try {
      await markAllAdvisorNotificationsRead(supabase, recipientId)
    } catch (cause) {
      console.error('No se pudieron marcar las notificaciones como leídas', cause)
      await reload()
    }
  }, [recipientId, reload, supabase])

  const unread = useMemo(() => items.filter(item => !item.read_at), [items])
  return {
    items,
    unread,
    unreadCount: unread.length,
    ready,
    loading,
    error,
    reload,
    markRead,
    markAllRead,
  }
}

const AdvisorNotificationsContext = createContext<ReturnType<typeof useAdvisorNotificationsState> | null>(null)

export function AdvisorNotificationsProvider({ children }: { children: ReactNode }) {
  const value = useAdvisorNotificationsState()
  return <AdvisorNotificationsContext.Provider value={value}>{children}</AdvisorNotificationsContext.Provider>
}

export function useAdvisorNotifications() {
  const value = useContext(AdvisorNotificationsContext)
  if (!value) throw new Error('Las notificaciones requieren AdvisorNotificationsProvider')
  return value
}
