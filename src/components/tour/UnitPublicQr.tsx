'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'
/* eslint-disable @next/next/no-img-element -- QR is generated locally as a data URL. */
import { useEffect, useRef, useState } from 'react'
import { QrCode, X } from 'lucide-react'
import QRCode from 'qrcode'
import { unitTourUrl } from '@/lib/tour/unitModels'

export function UnitPublicQr({ number }: { number: string }) {
  const { t, locale } = useTourLanguage()
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)
  const url = unitTourUrl(number) + (locale === 'en' ? '&lang=en' : '')

  useEffect(() => {
    setOpen(false)
    setImage('')
  }, [number])

  useEffect(() => {
    if (!open) return
    let active = true
    void QRCode.toDataURL(url, { width: 280, margin: 1, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (active) setImage(data)
      })
      .catch(() => {
        if (active) setImage('')
      })
    return () => {
      active = false
    }
  }, [open, url])

  useEffect(() => {
    if (!open) return
    cardRef.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  return (
    <div className="tour-ficha-qr mt-4 flex flex-col items-center">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border border-[#bda27e] bg-[#f7f3ee] px-4 text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase"
      >
        <QrCode size={16} strokeWidth={1.75} className="text-[#8e7654]" />
        QR
      </button>
      {open ? (
        <div
          ref={cardRef}
          role="dialog"
          aria-label={t(`QR público de la unidad ${number}`)}
          className="relative mt-2 w-full max-w-[15rem] rounded-2xl border border-[#bda27e]/55 bg-[#f7f3ee] px-3 pt-3 pb-3 text-center"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="absolute top-1 right-1 flex h-11 w-11 items-center justify-center rounded-full text-[#2B1A18]"
            aria-label={t('Cerrar')}
          >
            <X size={16} />
          </button>
          {image ? (
            <img
              src={image}
              alt={t(`QR público de la unidad ${number}`)}
              width={148}
              height={148}
              className="mx-auto h-[clamp(5.5rem,28vw,7.25rem)] w-[clamp(5.5rem,28vw,7.25rem)] rounded-xl bg-white p-1.5"
            />
          ) : (
            <div className="mx-auto grid h-[clamp(5.5rem,28vw,7.25rem)] w-[clamp(5.5rem,28vw,7.25rem)] place-items-center rounded-xl bg-white px-2 text-center text-[10px] text-[#756044]">
              {t('Generando el QR…')}
            </div>
          )}
          <p className="mt-2 text-[10px] font-semibold tracking-[0.16em] text-[#8e7654] uppercase">
            {t('Unidad')} {number}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-[#2B1A18]">
            {t('Escanea para abrir el recorrido de esta unidad.')}
          </p>
          <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center text-[11px] text-[#756044] underline">
            {t('Abrir enlace')}
          </a>
        </div>
      ) : null}
    </div>
  )
}
