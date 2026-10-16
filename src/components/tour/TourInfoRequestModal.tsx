'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { CheckCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { identifyTourLead, logTourEvent } from '@/lib/tour/visitorTracking'
import { cn } from '@/lib/utils'
import { useShowroomSheet } from '@/components/tour/useShowroomSheet'
import { getShowroomPhone, SHOWROOM_IDENTITY_EVENT } from '@/lib/tour/showroomIdentity'
import { infoRequestKey, infoRequestsSnapshot, readInfoRequests, saveInfoRequest, subscribeInfoRequests, type StoredInfoRequest } from '@/lib/tour/infoRequests'
import { commonAreaByCode, commonAreaLabel } from '@/lib/tour/commonAreas'
import { describeTourUnit, tourWhatsAppHref, type TourWhatsAppContext } from '@/lib/tour/tourWhatsApp'

function subscribeIdentity(onChange: () => void) {
  window.addEventListener(SHOWROOM_IDENTITY_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(SHOWROOM_IDENTITY_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

const MOTIVOS = [
  { value: 'informacion', label: 'Quiero más información' },
  { value: 'visita', label: 'Agendar una visita' },
  { value: 'precio', label: 'Consultar precio / disponibilidad' },
  { value: 'otro', label: 'Otro' },
] as const

const labelClass = 'text-[11px] font-medium tracking-[0.16em] text-[#2B1A18]/55 uppercase'

const fieldClass =
  'mt-1.5 h-11 w-full border border-[#2B1A18]/12 bg-white px-3.5 text-[13px] text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 transition-colors focus:border-[#BDA27E] focus:bg-[#f7f3ee]/50'

type TourInfoRequestModalProps = {
  open: boolean
  onClose: () => void
  onIdentified?: () => void
  contained?: boolean
  typologyCode: string
  typologyName?: string | null
  unitNumber?: string | null
  unitId?: string | null
  unitTypeId?: string | null
  floorLabel?: string | null
  finish?: string | null
  light?: string | null
  category?: string | null
  bedrooms?: number | null
  whatsappMessage: string
  whatsappContext: TourWhatsAppContext
}

export function TourInfoRequestModal({
  open,
  onClose,
  onIdentified,
  contained,
  typologyCode,
  typologyName,
  unitNumber,
  unitId,
  unitTypeId,
  floorLabel,
  finish,
  light,
  category,
  bedrooms,
  whatsappMessage,
  whatsappContext,
}: TourInfoRequestModalProps) {
  const { t, locale } = useTourLanguage()
  const sheetRef = useRef<HTMLFormElement>(null)
  useShowroomSheet(open, sheetRef)

  const [pending, setPending] = useState(false)
  const submitLockRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)
  const knownPhone = useSyncExternalStore(subscribeIdentity, getShowroomPhone, () => '')
  const requestsSnapshot = useSyncExternalStore(subscribeInfoRequests, infoRequestsSnapshot, () => '[]')
  const key = infoRequestKey(unitId, typologyCode)
  const storedRequest = readInfoRequests(requestsSnapshot).find((item) => item.key === key) ?? null
  const [remoteRequest, setRemoteRequest] = useState<StoredInfoRequest | null>(null)
  const [checkedKey, setCheckedKey] = useState('')
  const sentRequest = storedRequest ?? (remoteRequest?.key === key ? remoteRequest : null)

  useEffect(() => {
    if (!open || storedRequest) return
    let active = true
    const params = new URLSearchParams()
    if (unitId) params.set('unit_id', unitId)
    else if (typologyCode) params.set('typology_code', typologyCode)
    void fetch(`/api/tour/info-request/status?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() as Promise<{ record: StoredInfoRequest | null }> : { record: null })
      .then(({ record }) => {
        if (!active) return
        if (record?.key === key) {
          const restored = { ...record, unitNumber: unitNumber ?? record.unitNumber }
          setRemoteRequest(restored)
          saveInfoRequest(restored)
        }
      })
      .catch(() => undefined)
      .finally(() => { if (active) setCheckedKey(key) })
    return () => { active = false }
  }, [open, key, unitId, typologyCode, unitNumber, storedRequest?.sentAt])

  useEffect(() => {
    if (!open) return
    submitLockRef.current = false
    requestIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `info_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    logTourEvent({
      event_type: 'gate_mostrado',
      typology_code: typologyCode,
      unit_type_id: unitTypeId,
      metadata: { source: 'solicitar_informacion', unit_number: unitNumber ?? null },
    })
  }, [open, typologyCode, unitTypeId, unitNumber, unitId])

  if (!open) return null

  const subtitle = [
    unitNumber ? `Unidad ${unitNumber}` : null,
    floorLabel,
    typologyCode,
    typologyName,
  ]
    .filter(Boolean)
    .join(' · ')

  async function sendRequest(input: { phone: string; name?: string; email?: string; motivo: string; mensaje?: string }) {
    if (pending || submitLockRef.current) return
    submitLockRef.current = true
    setPending(true)
    try {
      await identifyTourLead({
        // The server resolves the existing lead by phone and preserves its real name/email.
        name: knownPhone ? undefined : input.name,
        email: knownPhone ? undefined : input.email,
        phone: knownPhone || input.phone,
        mode: knownPhone ? 'phone' : 'full',
        consent: true,
        contact_whatsapp: true,
        request_kind: 'info_request',
        client_request_id: requestIdRef.current,
        motivo: input.motivo,
        mensaje: input.mensaje || null,
        typology_code: typologyCode || null,
        unit_type_id: unitTypeId || null,
        unit_id: unitId || null,
        unit_number: unitNumber || null,
        interest_room: input.mensaje ? `${input.motivo}: ${input.mensaje}` : input.motivo,
        finish: finish || null,
        light: light || null,
      })
      toast.success(t('Listo. Te contactaremos a la brevedad.'))
      const record = { key, unitNumber: unitNumber ?? null, sentAt: new Date().toISOString() }
      setRemoteRequest(record)
      saveInfoRequest(record)
      onIdentified?.()
    } catch (error) {
      submitLockRef.current = false
      const message = error instanceof Error ? error.message : ''
      toast.error(
        t(message && !/<!DOCTYPE|<html/i.test(message)
          ? message
          : 'No se pudo enviar. Intenta de nuevo.'),
      )
    } finally {
      setPending(false)
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    if (data.get('consent') !== 'on') {
      toast.error(t('Marca la casilla de política de privacidad'))
      return
    }
    const motivo = MOTIVOS.find((item) => item.value === String(data.get('motivo') ?? ''))?.label || 'Consulta showroom'
    await sendRequest({
      phone: String(data.get('phone') ?? ''),
      name: String(data.get('name') ?? ''),
      email: String(data.get('email') ?? ''),
      motivo,
      mensaje: String(data.get('mensaje') ?? '').trim(),
    })
  }

  const area = commonAreaByCode(typologyCode)
  const subject = area ? commonAreaLabel(area, locale) : describeTourUnit({ unitNumber, category, bedrooms }, locale)
  const sentAt = sentRequest ? new Date(sentRequest.sentAt) : null
  const sentAtLabel = sentAt && !Number.isNaN(sentAt.getTime())
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(sentAt)
    : ''
  const checkingStatus = !sentRequest && checkedKey !== key

  return (
    <div
      className={cn(
        'z-[120] flex items-end justify-center sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label={t("Cerrar")}
        className="absolute inset-0 bg-[#2B1A18]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <form
        ref={sheetRef}
        onSubmit={(event) => void handleSubmit(event)}
        className="tour-modal-sheet relative z-10 m-3 flex w-full max-w-md flex-col rounded-2xl bg-[#f7f3ee] shadow-[0_24px_60px_rgba(43,26,24,0.28)] ring-1 ring-[#2B1A18]/10 sm:m-4"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B1A18]/8 px-5 py-4">
          <Image
            src="/LogoHorizontal.png"
            alt={t("Lavilet")}
            width={120}
            height={28}
            className="h-7 w-auto object-contain"
            priority
          />
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center text-[#2B1A18]/55 transition-colors hover:bg-[#2B1A18]/6 hover:text-[#2B1A18]"
            aria-label={t("Cerrar formulario")}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">
            {t(" Showroom ")}</p>
          <h2 className="mt-2 font-display text-[1.65rem] leading-tight font-semibold tracking-tight text-[#2B1A18]">
            {t(sentRequest ? 'Solicitud enviada' : 'Solicitar información')}</h2>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-[#2B1A18]/55">{t(subtitle)}</p>
          ) : null}

          {sentRequest ? (
            <div className="mt-6 space-y-3 text-sm text-[#2B1A18]">
              <CheckCircle2 size={34} className="text-[#70815e]" aria-hidden />
              <p>{t('Ya enviamos tu solicitud al equipo de La Vilet')}</p>
              <p className="font-semibold">{subject}</p>
              {sentAtLabel ? <p className="text-[#2B1A18]/60">{sentAtLabel}</p> : null}
              <p>{t('Un asesor te contactará pronto')}</p>
            </div>
          ) : checkingStatus ? (
            <p className="mt-6 text-sm text-[#2B1A18]/60">{t('Comprobando tu solicitud…')}</p>
          ) : knownPhone ? (
            <div className="mt-6 space-y-4 text-sm text-[#2B1A18]">
              <p>{t('¿Quieres que el asesor también te cuente sobre')} {subject}?</p>
              <button type="button" disabled={pending} onClick={() => void sendRequest({ phone: knownPhone, motivo: MOTIVOS[0].label })} className="tour-modal-submit flex h-11 w-full items-center justify-center bg-[#BDA27E] text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase disabled:opacity-60">
                {t(pending ? 'Enviando…' : 'Sí, solicitar información')}
              </button>
            </div>
          ) : <>
          <div className="mt-6 space-y-3.5">
            {!knownPhone ? (
              <>
                <label className="block">
                  <span className={labelClass}>{t("Nombre")}</span>
                  <input
                    name="name"
                    required
                    autoComplete="name"
                    placeholder={t("Tu nombre")}
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>{t("Email")}</span>
                  <input
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    placeholder={t("tu@email.com")}
                    className={fieldClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>{t("Teléfono")}</span>
                  <input
                    name="phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    placeholder={t("099 000 0000")}
                    className={fieldClass}
                  />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className={labelClass}>{t("Motivo de contacto")}</span>
              <select
                name="motivo"
                required
                defaultValue="informacion"
                className={cn(fieldClass, 'pr-10')}
              >
                {MOTIVOS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.label)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>{t("Mensaje")}</span>
              <textarea
                name="mensaje"
                rows={4}
                placeholder={t("Cuéntanos qué necesitas o cuándo te gustaría visitar")}
                className="mt-1.5 w-full resize-none border border-[#2B1A18]/12 bg-white px-3.5 py-3 text-[13px] text-[#2B1A18] outline-none placeholder:text-[#2B1A18]/35 transition-colors focus:border-[#BDA27E] focus:bg-[#f7f3ee]/50"
              />
            </label>
          </div>

          <label className="mt-5 flex items-start gap-2.5 text-[12px] leading-snug text-[#2B1A18]/60">
            <input
              name="consent"
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 border-[#2B1A18]/25 accent-[#BDA27E]"
            />
            <span>
              {t(" Leí y acepto la")}{t(' ')}
              <a
                href="/privacidad"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[#BDA27E]/60 underline-offset-2 hover:text-[#2B1A18]"
              >
                {t(" Política de privacidad ")}</a>{t(' y autorizo recibir información de La Vilet por WhatsApp.')}
            </span>
          </label>
          </>}
        </div>

        <div className="shrink-0 border-t border-[#2B1A18]/8 bg-[#f7f3ee] p-4">
          {sentRequest ? <div className="grid gap-2">
            {tourWhatsAppHref(whatsappMessage) ? <a href={tourWhatsAppHref(whatsappMessage)!} target="_blank" rel="noopener noreferrer" onClick={() => logTourEvent({ event_type: 'whatsapp_interest', typology_code: typologyCode, unit_type_id: unitTypeId, metadata: { context: whatsappContext } })} className="tour-modal-submit flex h-11 items-center justify-center bg-[#BDA27E] text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase">{t('Escribir por WhatsApp')}</a> : null}
            <button type="button" onClick={onClose} className="flex h-11 items-center justify-center border border-[#2B1A18]/20 text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase">{t('Cerrar')}</button>
          </div> : !checkingStatus && !knownPhone ? <button
            type="submit"
            disabled={pending}
            className="tour-modal-submit flex h-11 w-full items-center justify-center bg-[#BDA27E] text-[11px] font-semibold tracking-[0.18em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e] disabled:opacity-60"
          >
            {t(pending ? 'Enviando…' : 'Enviar')}
          </button> : null}
        </div>
      </form>
    </div>
  )
}
