import type { Metadata } from 'next'
import { HomeLanding } from '@/components/marketing/HomeLanding'

export const metadata: Metadata = {
  title: {
    absolute: 'Lavilet | Proyectos inmobiliarios',
  },
  description:
    'Departamentos y locales comerciales. Agenda una visita al showroom y recibe asesoría hasta la entrega.',
}

export default function Home() {
  return <HomeLanding />
}
