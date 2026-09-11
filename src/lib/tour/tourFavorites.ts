/**
 * Favoritos del showroom (unidades guardadas).
 * Fuente local inmediata + sync con eventos servidor (guardar_unidad / remove).
 */
import { getShowroomPhone, normalizeShowroomPhone } from '@/lib/tour/showroomIdentity'

export type TourFavorite = {
  unitId: string
  unitNumber: string
  typologyCode: string | null
  floor: string | null
  savedAt: string
}

const STORAGE_PREFIX = 'lv_tour_favorites:'

function storageKey(phone?: string | null) {
  const normalized = normalizeShowroomPhone(phone || getShowroomPhone() || '')
  return `${STORAGE_PREFIX}${normalized || 'guest'}`
}

function readList(key: string): TourFavorite[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TourFavorite[]
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item) => item?.unitId && item?.unitNumber)
  } catch {
    return []
  }
}

function writeList(key: string, items: TourFavorite[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent('lv-tour-favorites-changed'))
  } catch {
    /* ignore */
  }
}

export function listTourFavorites(phone?: string | null): TourFavorite[] {
  return readList(storageKey(phone)).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function isTourFavorite(unitId: string, phone?: string | null) {
  return listTourFavorites(phone).some((item) => item.unitId === unitId)
}

export function addTourFavorite(favorite: Omit<TourFavorite, 'savedAt'> & { savedAt?: string }) {
  const key = storageKey()
  const current = readList(key).filter((item) => item.unitId !== favorite.unitId)
  const next: TourFavorite = {
    unitId: favorite.unitId,
    unitNumber: favorite.unitNumber,
    typologyCode: favorite.typologyCode ?? null,
    floor: favorite.floor ?? null,
    savedAt: favorite.savedAt || new Date().toISOString(),
  }
  writeList(key, [next, ...current])
  return next
}

export function removeTourFavorite(unitId: string, phone?: string | null) {
  const key = storageKey(phone)
  writeList(
    key,
    readList(key).filter((item) => item.unitId !== unitId),
  )
}

/** Al identificar teléfono: fusiona favoritos guest → teléfono. */
export function mergeGuestFavoritesIntoPhone(phone: string) {
  const guestKey = `${STORAGE_PREFIX}guest`
  const phoneKey = storageKey(phone)
  const guest = readList(guestKey)
  if (guest.length === 0) return listTourFavorites(phone)
  const phoneItems = readList(phoneKey)
  const map = new Map<string, TourFavorite>()
  for (const item of [...phoneItems, ...guest]) {
    const prev = map.get(item.unitId)
    if (!prev || item.savedAt > prev.savedAt) map.set(item.unitId, item)
  }
  const merged = [...map.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  writeList(phoneKey, merged)
  try {
    window.localStorage.removeItem(guestKey)
  } catch {
    /* ignore */
  }
  return merged
}

export function upsertFavoritesFromServer(items: TourFavorite[], phone?: string | null) {
  const key = storageKey(phone)
  const local = readList(key)
  const map = new Map<string, TourFavorite>()
  for (const item of [...local, ...items]) {
    const prev = map.get(item.unitId)
    if (!prev || item.savedAt > prev.savedAt) map.set(item.unitId, item)
  }
  writeList(key, [...map.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)))
}
