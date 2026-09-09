'use client'

import { useState } from 'react'
import { BellRing } from 'lucide-react'
import { AppointmentDetailModal } from '@/components/inmobiliaria/agenda/AppointmentDetailModal'
import { useVisitInbox } from '@/hooks/inmobiliaria/useVisitInbox'
import type { VisitInboxItem } from '@/types/inmobiliaria'

export function AppointmentInboxBanner() {
  const { items } = useVisitInbox()
  const [selected, setSelected] = useState<VisitInboxItem | null>(null)

  return (
    <>
      {items.length > 0 && (
        <section
          aria-label="Citas pendientes"
          className="fixed top-[max(0.25rem,env(safe-area-inset-top))] left-1/2 z-40 flex max-h-[25dvh] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap justify-center gap-2 overflow-y-auto p-2"
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-label={`Ver cita pendiente de ${item.lead?.name || 'cliente'}`}
              aria-haspopup="dialog"
              onClick={() => setSelected(item)}
              className="appointment-notice inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 shadow-lg transition-colors hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700"
            >
              <BellRing size={16} aria-hidden="true" className="appointment-notice-bell text-amber-700" />
              Cita pendiente
            </button>
          ))}
        </section>
      )}
      {selected && (
        <AppointmentDetailModal
          appointment={{ id: selected.appointment_id, title: null }}
          isOpen
          onClose={() => setSelected(null)}
          tenantId={selected.tenant_id}
        />
      )}
    </>
  )
}
