import type { Metadata } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ProyectosView } from '@/components/marketing/ProyectosView'

export const metadata: Metadata = {
  title: 'Proyectos',
  description: 'Departamentos, locales y desarrollos Lavilet en comercialización.',
}

export default function ProyectosPage() {
  return (
    <MarketingShell>
      <ProyectosView />
    </MarketingShell>
  )
}
