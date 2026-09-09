import type { Metadata } from 'next'
import { HomeLanding } from '@/components/marketing/HomeLanding'

export const metadata: Metadata = {
  title: {
    absolute: 'Lavilet | Showroom 360°',
  },
  description:
    'Recorre el showroom virtual de Lavilet en 360°. Tipologías, ambientes y disponibilidad.',
}

export default function Home() {
  return <HomeLanding />
}
