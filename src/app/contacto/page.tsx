import type { Metadata, Viewport } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ContactoView } from '@/components/marketing/ContactoView'

export const metadata: Metadata = {
  title: 'Contacto',
  description: 'Agenda una visita al showroom o solicita disponibilidad Lavilet.',
}

export const viewport: Viewport = { themeColor: '#2a2924' }

export default function ContactoPage() {
  return (
    <MarketingShell>
      <ContactoView />
    </MarketingShell>
  )
}
