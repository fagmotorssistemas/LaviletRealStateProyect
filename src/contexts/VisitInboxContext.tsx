'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useVisitInbox } from '@/hooks/inmobiliaria/useVisitInbox'
import { prioritizeVisitInbox, visitIsOverdue, visitNeedsAttention, visitUrgencyKey } from '@/lib/inmobiliaria/visitInbox'
import type { VisitInboxItem } from '@/types/inmobiliaria'

export type VisitInboxTab = 'pending' | 'waiting' | 'all'
function useInbox() {
  const inbox = useVisitInbox()
  const [tab, setTab] = useState<VisitInboxTab>('pending')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<VisitInboxItem | null>(null)
  // Clock refreshed with each poll; shared by all counters and queue entries.
  const now = inbox.updatedAt
  const items = useMemo(() => prioritizeVisitInbox(inbox.items, now), [inbox.items, now])
  const pending = items.filter(visitNeedsAttention)
  const waiting = items.filter(item => item.status === 'awaiting_client')
  const overdue = pending.filter(item => visitIsOverdue(item, now))
  const openInbox = useCallback((next: VisitInboxTab = 'pending') => { setTab(next); setOpen(true); setSelected(null) }, [])
  const closeInbox = useCallback(() => setOpen(false), [])
  const openRequest = useCallback((item: VisitInboxItem) => { setSelected(item); setOpen(false) }, [])
  const backToInbox = useCallback(() => { setSelected(null); setOpen(true) }, [])
  const notified = useRef(new Set<string>())
  useEffect(() => {
    if (!inbox.ready) return
    for (const item of items) {
      const urgency = visitUrgencyKey(item)
      if (!urgency) continue
      const key = `${inbox.userId}:${urgency}`
      if (notified.current.has(key)) continue
      notified.current.add(key)
      toast.warning(`Coordinar cita urgente: ${item.lead?.name || 'Cliente'}`, {
        id: key, duration: 15000,
        description: 'No pudo elegir entre los horarios propuestos. El bot está pausado; revisa el resumen y llámale para coordinar.',
        action: { label: 'Revisar ahora', onClick: () => openRequest(item) },
      })
    }
  }, [inbox.ready, inbox.userId, items, openRequest])
  return { ...inbox, items, pending, waiting, overdue, now, tab, setTab, open, selected, openInbox, closeInbox, openRequest, backToInbox }
}

const VisitInboxContext = createContext<ReturnType<typeof useInbox> | null>(null)
export function VisitInboxProvider({ children }: { children: ReactNode }) {
  const inbox = useInbox()
  return <VisitInboxContext.Provider value={inbox}>{children}</VisitInboxContext.Provider>
}
export function useVisitInboxContext() {
  const value = useContext(VisitInboxContext)
  if (!value) throw new Error('La bandeja de citas requiere VisitInboxProvider')
  return value
}
