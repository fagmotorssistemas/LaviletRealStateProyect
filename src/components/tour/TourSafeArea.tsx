'use client'

import { Component, type ReactNode } from 'react'
import { TourViewerLoader } from '@/app/tour/TourViewerLoader'

class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full min-h-[320px] items-center justify-center bg-black px-6 text-center text-sm text-white/70">
          No se pudo cargar el showroom 360°. Recarga la página para intentarlo de nuevo.
        </div>
      )
    }
    return this.props.children
  }
}

export function TourSafeArea({ embedded = false }: { embedded?: boolean }) {
  return (
    <TourBoundary>
      <TourViewerLoader embedded={embedded} />
    </TourBoundary>
  )
}
