'use client'

import dynamic from 'next/dynamic'

const TourViewer = dynamic(
  () => import('@/components/tour/TourViewer').then((mod) => mod.TourViewer),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[320px] w-full bg-black" aria-hidden />,
  },
)

export function TourViewerLoader({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? 'h-full w-full' : 'h-[100dvh] w-full'}>
      <TourViewer embedded={embedded} />
    </div>
  )
}
