import type { Metadata, Viewport } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { NosotrosView } from '@/components/marketing/NosotrosView'

export const metadata: Metadata = {
  title: 'Nosotros',
  description: 'La historia y el lugar de La Vilet en Cuenca.',
}

export const viewport: Viewport = { themeColor: '#2a2924' }

export default function NosotrosPage() {
  return (
    <MarketingShell>
      <NosotrosView />
    </MarketingShell>
  )
}
