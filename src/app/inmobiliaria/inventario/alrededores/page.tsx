'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { SurroundingsCaptureStudio } from '@/components/inmobiliaria/inventory/SurroundingsCaptureStudio'
import { FLOOR_PLAN_SCOPE } from '@/lib/tour/floorPlanHotspots'

export default function AlrededoresPage() {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[560px] flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="crm-title">Alrededores</h1>
          <p className="text-sm text-[#8a8d87]">
            Foto real del edificio. El plano se superpone, el giro lo inclina y la captura guarda una copia.
          </p>
        </div>
        <Link
          href="/inmobiliaria/inventario"
          className="inline-flex items-center gap-1.5 text-sm text-[#555850] hover:text-[#3a3d36]"
        >
          <ArrowLeft size={16} />
          Inventario
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <SurroundingsCaptureStudio typologyCode={FLOOR_PLAN_SCOPE} />
      </div>
    </div>
  )
}
