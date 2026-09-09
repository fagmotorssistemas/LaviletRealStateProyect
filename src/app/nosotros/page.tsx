import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { NosotrosView } from '@/components/marketing/NosotrosView'

export const metadata: Metadata = {
  title: 'Nosotros',
  description: 'La historia y el lugar de La Vilet en Cuenca.',
}

export default function NosotrosPage() {
  return (
    <MarketingShell>
      <NosotrosView />
    </MarketingShell>
  )
}
