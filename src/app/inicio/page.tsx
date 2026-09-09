import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { FullLanding } from '@/components/marketing/FullLanding'

export const metadata: Metadata = {
  title: {
    absolute: 'Lavilet | Proyectos inmobiliarios',
  },
  description:
    'Departamentos y locales comerciales. Agenda una visita al showroom y recibe asesoría hasta la entrega.',
}

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ unidad?: string }>
}) {
  const params = await searchParams
  const unitDeepLink = Boolean(params.unidad?.trim())

  return (
    <MarketingShell>
      <FullLanding unitDeepLink={unitDeepLink} />
    </MarketingShell>
  )
}
