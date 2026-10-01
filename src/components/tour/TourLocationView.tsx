'use client'

import { X } from 'lucide-react'
import { SITE } from '@/lib/marketing/site'
import { useTourLanguage } from '@/lib/tour/tourLocale'

export function TourLocationView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTourLanguage()
  if (!open) return null
  return (
    <div className="absolute inset-0 z-[220] bg-black">
      <iframe
        title={t('Ubicación de La Vilet')}
        src={SITE.location.embedUrl}
        className="h-full w-full border-0"
        allowFullScreen
        referrerPolicy="no-referrer-when-downgrade"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label={t('Cerrar ubicación')}
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-10 inline-flex h-11 items-center gap-2 rounded-full bg-[#29251e]/90 px-4 text-xs text-[#f7f3ee] shadow-md"
      >
        <X size={16} aria-hidden="true" />
        {t('Cerrar')}
      </button>
    </div>
  )
}
