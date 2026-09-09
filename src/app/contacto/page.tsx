import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ContactoView } from '@/components/marketing/ContactoView'

export const metadata: Metadata = {
  title: 'Contacto',
  description: 'Agenda una visita al showroom o solicita disponibilidad Lavilet.',
}

export default function ContactoPage() {
  return (
    <MarketingShell>
      <ContactoView />
    </MarketingShell>
  )
}
