import type { Metadata } from 'next'
import { TourViewerLoader } from './TourViewerLoader'

export const metadata: Metadata = {
  title: 'Tour virtual',
  description: 'Showroom virtual 360°',
}

export default function TourPage() {
  return <TourViewerLoader />
}
