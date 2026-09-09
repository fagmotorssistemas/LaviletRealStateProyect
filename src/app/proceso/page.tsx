import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ProcesoView } from '@/components/marketing/ProcesoView'

export const metadata: Metadata = {
  title: 'Proceso',
  description: 'Cómo acompañamos tu visita, reserva y entrega en Lavilet.',
}

export default function ProcesoPage() {
  return (
    <MarketingShell>
      <ProcesoView />
    </MarketingShell>
  )
}
