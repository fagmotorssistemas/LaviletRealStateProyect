import type { Metadata, Viewport } from 'next'
import { MarketingShell } from '@/components/marketing/MarketingShell'
import { ProyectosView } from '@/components/marketing/ProyectosView'

export const metadata: Metadata = {
  title: 'Proyectos',
  description: 'Departamentos, locales y desarrollos Lavilet en comercialización.',
}

export const viewport: Viewport = { themeColor: '#2a2924' }

export default function ProyectosPage() {
  return (
    <MarketingShell>
      <ProyectosView />
    </MarketingShell>
  )
}
