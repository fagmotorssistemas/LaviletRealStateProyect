'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { QrCode, X } from 'lucide-react'
import QRCode from 'qrcode'
import { unitTourUrl } from '@/lib/tour/unitModels'
import { useTourLanguage } from '@/lib/tour/tourLocale'

export function QrShareButton({ number, className }: { number: string; className?: string }) {
  const { t, locale } = useTourLanguage()
  const [open, setOpen] = useState(false)
  const [src, setSrc] = useState('')
  const [host, setHost] = useState<HTMLElement | null>(null)
  const url = `${unitTourUrl(number)}${locale === 'en' ? '&lang=en' : ''}`

  useEffect(() => {
    setHost(document.querySelector<HTMLElement>('.tour-root') ?? document.body)
  }, [])

  useEffect(() => {
    if (!open) return
    let active = true
    void QRCode.toDataURL(url, { width: 176, margin: 1, errorCorrectionLevel: 'M' })
      .then((value) => {
        if (active) setSrc(value)
      })
      .catch(() => {
        if (active) setSrc('')
      })
    return () => {
      active = false
    }
  }, [open, url])

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className={
          className ??
          'inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[#BDA27E] bg-[#f7f3ee] px-3 text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase'
        }
      >
        <QrCode size={16} strokeWidth={1.75} />
        QR
      </button>
      {open && host
        ? createPortal(
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center bg-[#2B1A18]/40 p-4 backdrop-blur-sm"
          onClick={(event) => {
            event.stopPropagation()
            setOpen(false)
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`QR ${number}`}
            className="relative w-[min(20rem,calc(100%-1rem))] rounded-[1.5rem] bg-[#f7f3ee] px-5 pb-5 pt-6 text-center shadow-[0_18px_50px_rgba(43,26,24,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t('Cerrar')}
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 flex h-11 w-11 items-center justify-center rounded-full text-[#2B1A18]"
            >
              <X size={18} />
            </button>
            <p className="text-[12px] font-semibold tracking-[0.2em] text-[#8e7654] uppercase">UNIDAD {number}</p>
            <div className="mx-auto mt-4 flex h-[176px] w-[176px] items-center justify-center rounded-2xl bg-white">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- data URL generated in the browser
                <img src={src} width={176} height={176} alt="" />
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="h-11 rounded-full bg-[#2B1A18] px-2 text-[11px] font-semibold tracking-[0.08em] text-[#f7f3ee] uppercase"
                onClick={() => {
                  void navigator.clipboard.writeText(url)
                }}
              >
                {t('Copiar enlace')}
              </button>
              <button
                type="button"
                className="h-11 rounded-full border border-[#BDA27E] bg-transparent px-2 text-[11px] font-semibold tracking-[0.08em] text-[#2B1A18] uppercase"
                onClick={() => {
                  if (typeof navigator.share === 'function') {
                    void navigator.share({ title: `Unidad ${number}`, url }).catch(() => undefined)
                    return
                  }
                  void navigator.clipboard.writeText(url)
                }}
              >
                {t('Compartir')}
              </button>
            </div>
          </div>
        </div>,
          host,
        )
        : null}
    </>
  )
}
