'use client'

import { Suspense } from 'react'
import { ClientSimulatorPage } from '@/components/financing/ClientSimulatorPage'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { Spinner } from '@/components/ui/Spinner'

/** Vista CRM del simulador (misma herramienta que /simulador público). */
export default function InmobiliariaSimuladorPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Contabilidad"
        title="Simulador"
        description="Misma herramienta que ven los clientes. Elija un departamento y revise cuota y retorno."
      />
      <Suspense
        fallback={
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        }
      >
        <ClientSimulatorPage variant="crm" />
      </Suspense>
    </div>
  )
}
