import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { UbicanosView } from '@/components/marketing/UbicanosView'
import { getMarketingProjectLocation } from '@/lib/marketing/location'

export const metadata: Metadata = {
  title: 'Ubícanos',
  description: 'Ubicación de La Vilet en Cuenca, Ecuador.',
}

export const dynamic = 'force-dynamic'

export default async function UbicanosPage() {
  const project = await getMarketingProjectLocation()

  return (
    <MarketingShell>
      <UbicanosView project={project} />
    </MarketingShell>
  )
}
