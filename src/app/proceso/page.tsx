import type { Metadata, Viewport } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ProcesoView } from '@/components/marketing/ProcesoView'

export const metadata: Metadata = {
  title: 'Proceso',
  description: 'Cómo acompañamos tu visita, reserva y entrega en Lavilet.',
}

export const viewport: Viewport = { themeColor: '#2a2924' }

export default function ProcesoPage() {
  return (
    <MarketingShell>
      <ProcesoView />
    </MarketingShell>
  )
}
