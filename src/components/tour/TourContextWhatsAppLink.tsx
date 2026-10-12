'use client'

import { MessageCircle } from 'lucide-react'
import { useTourLanguage } from '@/lib/tour/tourLocale'
import { tourWhatsAppHref, type TourWhatsAppContext } from '@/lib/tour/tourWhatsApp'

export function TourContextWhatsAppLink({
  context,
  message,
  className,
  typologyCode,
  unitTypeId,
  label,
}: {
  context: TourWhatsAppContext
  message: string
  className: string
  typologyCode?: string | null
  unitTypeId?: string | null
  label?: string
}) {
  const { t } = useTourLanguage()
  const href = tourWhatsAppHref(message)
  if (!href) return null
  return <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className={className}
    aria-label={t('Consultar por WhatsApp')}
    title={t('Consultar por WhatsApp')}
    onClick={() => {
      void import('@/lib/tour/visitorTracking').then(({ logTourEvent }) => {
        logTourEvent({ event_type: 'whatsapp_interest', typology_code: typologyCode ?? undefined, unit_type_id: unitTypeId ?? undefined, metadata: { context } })
      })
    }}
  >
    <MessageCircle size={18} strokeWidth={1.75} aria-hidden />
    {label ? <span>{t(label)}</span> : null}
  </a>
}
