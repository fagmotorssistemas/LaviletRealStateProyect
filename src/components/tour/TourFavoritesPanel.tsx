'use client'

import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import {
  listTourFavorites,
  removeTourFavorite,
  upsertFavoritesFromServer,
  type TourFavorite,
} from '@/lib/tour/tourFavorites'
import { getShowroomPhone, isShowroomIdentified } from '@/lib/tour/showroomIdentity'
import { logTourEvent } from '@/lib/tour/visitorTracking'
import { cn } from '@/lib/utils'

type TourFavoritesPanelProps = {
  open: boolean
  onClose: () => void
  onOpenUnit: (favorite: TourFavorite) => void
  contained?: boolean
}

export function TourFavoritesPanel({
  open,
  onClose,
  onOpenUnit,
  contained,
}: TourFavoritesPanelProps) {
  const [items, setItems] = useState<TourFavorite[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = () => setItems(listTourFavorites())

  useEffect(() => {
    if (!open) return
    refresh()
    const onChange = () => refresh()
    window.addEventListener('lv-tour-favorites-changed', onChange)
    return () => window.removeEventListener('lv-tour-favorites-changed', onChange)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const phone = getShowroomPhone()
    const qs = phone ? `?phone=${encodeURIComponent(phone)}` : ''
    void fetch(`/api/tour/favorites${qs}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as { favorites?: TourFavorite[] }
        if (cancelled || !json.favorites) return
        upsertFavoritesFromServer(json.favorites, phone || null)
        refresh()
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const remove = (item: TourFavorite) => {
    removeTourFavorite(item.unitId)
    refresh()
    logTourEvent({
      event_type: 'guardar_unidad',
      typology_code: item.typologyCode,
      metadata: {
        action: 'remove',
        unit_id: item.unitId,
        unit_number: item.unitNumber,
        floor: item.floor,
      },
    })
  }

  return (
    <div
      className={cn(
        'z-[80] flex items-end justify-center sm:items-center',
        contained ? 'absolute inset-0' : 'fixed inset-0',
      )}
    >
      <button
        type="button"
        aria-label="Cerrar favoritos"
        className="absolute inset-0 bg-[#2B1A18]/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative z-10 m-3 flex max-h-[min(88dvh,560px)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-[#f7f3ee] shadow-[0_24px_60px_rgba(43,26,24,0.28)] ring-1 ring-[#2B1A18]/10 sm:m-4">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B1A18]/8 px-5 py-4">
          <div>
            <p className="text-[11px] font-medium tracking-[0.28em] text-[#BDA27E] uppercase">
              Showroom
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-[#2B1A18]">Favoritos</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center text-[#2B1A18]/55 hover:text-[#2B1A18]"
            aria-label="Cerrar"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!isShowroomIdentified() ? (
            <p className="mb-3 text-[12px] leading-relaxed text-[#2B1A18]/55">
              Si guardás con tu celular, al volver a ingresarlo vas a recuperar estos favoritos.
            </p>
          ) : (
            <p className="mb-3 text-[12px] leading-relaxed text-[#2B1A18]/55">
              Sesión ····{getShowroomPhone().replace(/\D/g, '').slice(-4)}
            </p>
          )}

          {loading && items.length === 0 ? (
            <p className="text-sm text-[#2B1A18]/50">Cargando…</p>
          ) : null}

          {items.length === 0 && !loading ? (
            <p className="text-sm text-[#2B1A18]/55">
              Todavía no guardaste departamentos. Usá Guardar en cualquier unidad.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <li
                  key={item.unitId}
                  className="flex items-center gap-2 rounded-xl bg-white p-2.5 ring-1 ring-[#2B1A18]/8"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onOpenUnit(item)
                      onClose()
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block text-[13px] font-semibold text-[#2B1A18]">
                      Unidad {item.unitNumber}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#2B1A18]/55">
                      {[item.typologyCode, item.floor].filter(Boolean).join(' · ') || 'Favorito'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(item)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center text-[#8a5c58] hover:bg-[#8a5c58]/10"
                    aria-label={`Eliminar unidad ${item.unitNumber}`}
                    title="Eliminar"
                  >
                    <Trash2 size={15} strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

