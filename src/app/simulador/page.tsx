import type { Metadata } from 'next'
import { Suspense } from 'react'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ClientSimulatorPage } from '@/components/financing/ClientSimulatorPage'
import { Spinner } from '@/components/ui/Spinner'

export const metadata: Metadata = {
  title: 'Simulador de inversión',
  description: 'Calcule la cuota y el retorno estimado de un departamento Lavilet.',
}

export default function SimuladorPage() {
  return (
    <MarketingShell>
      {/* pt compensates fixed SiteHeader (h-16) so content is not covered */}
      <div className="px-4 pt-24 pb-12 sm:px-8 sm:pt-28 sm:pb-16">
        <Suspense
          fallback={
            <div className="flex justify-center py-16">
              <Spinner size="lg" />
            </div>
          }
        >
          <ClientSimulatorPage />
        </Suspense>
      </div>
    </MarketingShell>
  )
}
