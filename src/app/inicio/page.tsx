import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { FullLanding } from '@/components/marketing/FullLanding'

export const metadata: Metadata = {
  title: {
    absolute: 'La Vilet | Suites, departamentos y locales en Cuenca',
  },
  description:
    'Explora en 360° suites, departamentos de 2 y 3 dormitorios y locales comerciales en Puertas del Sol, Cuenca.',
}

export default async function InicioPage({
  searchParams,
}: {
  searchParams: Promise<{ unidad?: string }>
}) {
  const params = await searchParams
  const unit = params.unidad?.trim()
  if (unit) {
    redirect(`/tour?unidad=${encodeURIComponent(unit)}`)
  }

  return (
    <MarketingShell>
      <FullLanding />
    </MarketingShell>
  )
}
