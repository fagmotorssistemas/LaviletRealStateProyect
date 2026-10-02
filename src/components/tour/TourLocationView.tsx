'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { X } from 'lucide-react'
import { SITE } from '@/lib/marketing/site'
import { useTourLanguage } from '@/lib/tour/tourLocale'

const MAP = 'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/ubicacion_lavilet.png'

export function TourLocationView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTourLanguage()
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="absolute inset-0 z-[80] overflow-y-auto bg-[#f7f3ee] text-[#29251e] md:overflow-hidden">
      <div className="flex h-full min-h-0 flex-col gap-8 px-5 pt-[calc(4.5rem+env(safe-area-inset-top))] pb-6 sm:px-8 md:flex-row md:items-center md:gap-10 lg:px-12">
        <div className="flex w-full shrink-0 flex-col items-start gap-6 md:w-[15rem]">
          <p className="text-sm leading-relaxed font-semibold tracking-wide text-[#8e7654] uppercase">
            Ricardo Darquea Granda<br />
            & Elena Landívar
          </p>
          <p className="text-sm leading-relaxed text-[#29251e]">Puertas del Sol, Cuenca</p>
          <a
            href={SITE.location.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex h-28 w-28 items-center justify-center rounded-full border border-[#bda27e] bg-[#f7f3ee] text-center transition-colors hover:bg-[#29251e]"
          >
            <span className="text-[10px] font-semibold tracking-widest whitespace-pre-line text-[#8e7654] transition-colors group-hover:text-[#f7f3ee]">
              {t('ABRIR EN\nGOOGLE\nMAPS')}
            </span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center gap-2 text-xs text-[#756044] underline"
          >
            <X size={14} aria-hidden="true" />
            {t('Cerrar')}
          </button>
        </div>
        <div className="relative min-h-[70dvh] min-w-0 flex-1 md:h-full md:min-h-0">
          <Image
            src={MAP}
            alt={t('Ubicación de La Vilet')}
            fill
            className="object-contain object-center drop-shadow-[0_18px_40px_rgba(41,37,30,0.16)]"
            sizes="(max-width: 768px) 100vw, 78vw"
            priority
            unoptimized
          />
        </div>
      </div>
    </div>
  )
}
