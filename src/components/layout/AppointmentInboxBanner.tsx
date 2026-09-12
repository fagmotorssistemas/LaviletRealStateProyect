'use client'

import { AppointmentDetailModal } from '@/components/inmobiliaria/agenda/AppointmentDetailModal'
import { VisitInboxDrawer } from '@/components/inmobiliaria/agenda/VisitInboxDrawer'
import { useVisitInboxContext } from '@/contexts/VisitInboxContext'

export function AppointmentInboxBanner() {
  const { open, selected, backToInbox, reload } = useVisitInboxContext()
  return (
    <>
      {open && <VisitInboxDrawer />}
      {selected && <AppointmentDetailModal
        appointment={{ id: selected.appointment_id, title: null }}
        isOpen
        onClose={backToInbox}
        onAppointmentUpdated={() => { void reload() }}
        tenantId={selected.tenant_id}
      />}
    </>
  )
}
