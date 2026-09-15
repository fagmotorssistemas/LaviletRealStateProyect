import type { TourUnitSummary } from '@/types/tour'
import { unitFloorNumber } from '@/lib/tour/floorPlanHotspots'

/** Nombre público del asistente de voz del showroom. */
export const TOUR_VOICE_ASSISTANT_NAME = 'Lia'

export function voiceAssistantGreeting(): string {
  return `Hola, qué gusto saludarle. Soy ${TOUR_VOICE_ASSISTANT_NAME}, de La Vilet. Puedo ayudarle con departamentos, suites o locales comerciales. Pregúnteme con confianza: dormitorios, piso, presupuesto o un local… ¿En qué le gustaría que le ayude?`
}

export function voiceSoftPhoneAskLine(): string {
  return ' ¿Desea dejarme su WhatsApp para tenerle presente? Si quiere, dígamelo ahora y con gusto lo anoto.'
}

/** Cómo cerrar la conversación con Lia. */
export function voiceCloseHintLine(): string {
  return ' Si no desea más información, diga gracias y cierro.'
}

export const VOICE_FAREWELL =
  'Muchas gracias por su tiempo. Fue un gusto atenderle. Cuando quiera, aquí estaré para seguir ayudándole.'

/** Parte el texto en trozos cortos para que el TTS de OpenAI empiece antes. */
export function splitSpeakChunks(text: string): string[] {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return []

  const byOption = t.split(/(?=Opción\s+\d+:)/i).map((s) => s.trim()).filter(Boolean)
  if (byOption.length > 1) {
    const head = byOption[0]!
    // "3 opciones:" + opciones → el intro suena ya; el resto en paralelo.
    if (head.length <= 80 && /:$/.test(head)) return byOption
    return byOption
  }

  const parts = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length <= 1) return [t]

  const merged: string[] = []
  for (const part of parts) {
    const prev = merged[merged.length - 1]
    if (prev && (prev.length < 48 || part.length < 36)) {
      merged[merged.length - 1] = `${prev} ${part}`
    } else {
      merged.push(part)
    }
  }
  return merged.length > 0 ? merged : [t]
}

/** Filtros que extrae el modelo a partir de lo que dijo el visitante. */
export type VoiceUnitCategory = 'departamento' | 'suite' | 'local'

/** Criterio parcial para búsquedas mixtas (OR entre grupos). */
export type VoiceAssistOrGroup = {
  category: VoiceUnitCategory | null
  bedrooms: number | null
  bathrooms: number | null
}

export type VoiceAssistFilters = {
  bedrooms: number | null
  bathrooms: number | null
  floor_min: number | null
  floor_max: number | null
  /** Preferencia vaga cuando no hay número de piso. */
  floor_pref: 'bajo' | 'medio' | 'alto' | null
  price_min: number | null
  price_max: number | null
  typology_code: string | null
  only_available: boolean
  area_min_m2: number | null
  /** Orden por precio: “más barato” / “más caro”. */
  sort_pref: 'barato' | 'caro' | null
  /** departamento | suite | local (pedido simple). */
  category: VoiceUnitCategory | null
  /**
   * Búsqueda mixta: p. ej. locales O departamentos de 1 dormitorio.
   * Si hay grupos, se hace OR entre ellos; precio/piso/sort siguen siendo comunes.
   */
  or_groups: VoiceAssistOrGroup[] | null
}

export type VoiceAssistUnitCard = {
  id: string
  unit_number: string
  floor: string | null
  floor_number: number | null
  bedrooms: number | null
  bathrooms: number | null
  area_total_m2: number | null
  price: number | null
  status: string
  typology_code: string | null
  category: VoiceUnitCategory | null
  blurb: string
}

export type VoiceAssistResult = {
  transcript: string
  speak: string
  filters: VoiceAssistFilters
  matches: VoiceAssistUnitCard[]
  follow_up: string | null
}

export type VoiceAssistCatalogUnit = {
  id: string
  unit_number: string
  floor: string | null
  floor_number: number | null
  bedrooms: number | null
  bathrooms: number | null
  area_total_m2: number | null
  price: number | null
  status: string
  typology_code: string | null
  category: VoiceUnitCategory | null
}

export const EMPTY_VOICE_FILTERS: VoiceAssistFilters = {
  bedrooms: null,
  bathrooms: null,
  floor_min: null,
  floor_max: null,
  floor_pref: null,
  price_min: null,
  price_max: null,
  typology_code: null,
  only_available: true,
  area_min_m2: null,
  sort_pref: null,
  category: null,
  or_groups: null,
}

const OFFERABLE = new Set(['disponible', 'en_preventa'])

export function resolveVoiceCategory(input: {
  category?: string | null
  unit_number?: string | null
  bedrooms?: number | null
}): VoiceUnitCategory | null {
  const raw = String(input.category ?? '')
    .trim()
    .toLowerCase()
  if (raw === 'local' || raw === 'local comercial' || raw === 'comercial') return 'local'
  if (raw === 'suite') return 'suite'
  if (raw === 'departamento' || raw === 'dept' || raw === 'dpto') return 'departamento'
  if (/^lc[-_]?\d/i.test(String(input.unit_number ?? ''))) return 'local'
  return null
}

export function toVoiceCatalog(units: TourUnitSummary[]): VoiceAssistCatalogUnit[] {
  return units.map((u) => ({
    id: u.id,
    unit_number: u.unit_number,
    floor: u.floor,
    floor_number: unitFloorNumber(u),
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    area_total_m2: u.area_total_m2,
    price: u.published_commercial_price,
    status: String(u.status ?? ''),
    typology_code: u.typology_code ?? null,
    category: resolveVoiceCategory(u),
  }))
}

function formatPriceShort(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
  if (value >= 1000) return `$${Math.round(value / 1000)}k`
  return `$${Math.round(value)}`
}

function unitBlurb(u: VoiceAssistCatalogUnit) {
  const cat = resolveVoiceCategory(u)
  const bits: string[] = []
  if (cat === 'local') {
    bits.push('Local comercial')
    if (u.area_total_m2 != null && Number.isFinite(u.area_total_m2)) {
      bits.push(`${Math.round(u.area_total_m2)} m²`)
    }
  } else {
    if (u.bedrooms != null && u.bedrooms > 0) {
      bits.push(u.bedrooms === 1 ? '1 dorm.' : `${u.bedrooms} dorm.`)
    }
    if (u.bathrooms != null && u.bathrooms > 0) {
      bits.push(u.bathrooms === 1 ? '1 baño' : `${u.bathrooms} baños`)
    }
  }
  if (u.floor) bits.push(`piso ${u.floor}`)
  else if (u.floor_number != null) bits.push(`piso ${u.floor_number}`)
  const price = formatPriceShort(u.price)
  if (price) bits.push(price)
  return bits.join(' · ') || 'Ver ficha'
}

function floorPrefRange(pref: VoiceAssistFilters['floor_pref']): { min: number; max: number } | null {
  if (pref === 'bajo') return { min: 0, max: 2 }
  if (pref === 'medio') return { min: 2, max: 4 }
  if (pref === 'alto') return { min: 4, max: 99 }
  return null
}

function scoreUnitAgainstBranch(
  u: VoiceAssistCatalogUnit,
  f: VoiceAssistFilters,
  branch: {
    category: VoiceUnitCategory | null
    bedrooms: number | null
    bathrooms: number | null
  },
): number | null {
  if (f.only_available !== false && !OFFERABLE.has(u.status)) return null

  const unitCat = resolveVoiceCategory(u)
  let score = 0

  if (branch.category) {
    if (unitCat !== branch.category) return null
    score += 10
  } else if (branch.bedrooms != null || branch.bathrooms != null) {
    // Pedidos residenciales sin categoría: no mezclar locales.
    if (unitCat === 'local') return null
  }

  if (branch.bedrooms != null) {
    if (unitCat === 'local') return null
    if (u.bedrooms == null) return null
    if (u.bedrooms !== branch.bedrooms) return null
    score += 8
  }

  if (branch.bathrooms != null) {
    if (unitCat === 'local') return null
    if (u.bathrooms == null) score -= 1
    else if (u.bathrooms >= branch.bathrooms) score += 4
    else return null
  }

  if (f.typology_code) {
    if ((u.typology_code || '').toUpperCase() === f.typology_code.toUpperCase()) score += 6
    else return null
  }

  if (f.price_max != null && u.price != null) {
    if (u.price > f.price_max) return null
    score += 3
  }
  if (f.price_min != null && u.price != null) {
    if (u.price < f.price_min) return null
    score += 2
  }

  if (f.area_min_m2 != null && u.area_total_m2 != null) {
    if (u.area_total_m2 < f.area_min_m2) return null
    score += 2
  }

  const floor = u.floor_number
  if (f.floor_min != null || f.floor_max != null) {
    if (floor == null) score -= 1
    else {
      if (f.floor_min != null && floor < f.floor_min) return null
      if (f.floor_max != null && floor > f.floor_max) return null
      score += 4
    }
  } else if (f.floor_pref) {
    const range = floorPrefRange(f.floor_pref)
    if (range && floor != null) {
      if (floor < range.min || floor > range.max) score -= 3
      else score += 4
    }
  }

  if (OFFERABLE.has(u.status)) score += 1
  return score
}

function scoreUnit(u: VoiceAssistCatalogUnit, f: VoiceAssistFilters): number | null {
  const groups = f.or_groups?.filter(Boolean) ?? []
  if (groups.length > 0) {
    let best: number | null = null
    for (const g of groups) {
      const s = scoreUnitAgainstBranch(u, f, g)
      if (s != null && (best == null || s > best)) best = s
    }
    return best
  }
  return scoreUnitAgainstBranch(u, f, {
    category: f.category,
    bedrooms: f.bedrooms,
    bathrooms: f.bathrooms,
  })
}

function toUnitCard(u: VoiceAssistCatalogUnit): VoiceAssistUnitCard {
  return {
    id: u.id,
    unit_number: u.unit_number,
    floor: u.floor,
    floor_number: u.floor_number,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    area_total_m2: u.area_total_m2,
    price: u.price,
    status: u.status,
    typology_code: u.typology_code,
    category: resolveVoiceCategory(u),
    blurb: unitBlurb(u),
  }
}

export function matchVoiceUnits(
  catalog: VoiceAssistCatalogUnit[],
  filters: VoiceAssistFilters,
  limit = 3,
): VoiceAssistUnitCard[] {
  const groups = filters.or_groups?.filter(Boolean) ?? []

  // Búsqueda mixta: repartir cupos entre grupos para no mostrar solo una categoría.
  if (groups.length > 1) {
    const perGroup = Math.max(1, Math.ceil(limit / groups.length))
    const picked: VoiceAssistCatalogUnit[] = []
    const seen = new Set<string>()

    for (const g of groups) {
      const branchFilters: VoiceAssistFilters = {
        ...filters,
        or_groups: null,
        category: g.category,
        bedrooms: g.bedrooms,
        bathrooms: g.bathrooms,
      }
      const ranked = catalog
        .map((u) => ({ u, score: scoreUnit(u, branchFilters) }))
        .filter((row): row is { u: VoiceAssistCatalogUnit; score: number } => row.score != null)
        .sort((a, b) => {
          if (filters.sort_pref === 'barato' || filters.sort_pref === 'caro') {
            const pa = a.u.price
            const pb = b.u.price
            if (pa == null && pb == null) return b.score - a.score
            if (pa == null) return 1
            if (pb == null) return -1
            const byPrice = filters.sort_pref === 'barato' ? pa - pb : pb - pa
            if (byPrice !== 0) return byPrice
            return b.score - a.score
          }
          return b.score - a.score
        })

      let taken = 0
      for (const row of ranked) {
        if (seen.has(row.u.id)) continue
        seen.add(row.u.id)
        picked.push(row.u)
        taken += 1
        if (taken >= perGroup || picked.length >= limit) break
      }
      if (picked.length >= limit) break
    }

    // Completar cupos restantes con el ranking global OR.
    if (picked.length < limit) {
      const rest = catalog
        .map((u) => ({ u, score: scoreUnit(u, filters) }))
        .filter((row): row is { u: VoiceAssistCatalogUnit; score: number } => row.score != null)
        .sort((a, b) => b.score - a.score)
      for (const row of rest) {
        if (seen.has(row.u.id)) continue
        seen.add(row.u.id)
        picked.push(row.u)
        if (picked.length >= limit) break
      }
    }

    return picked.slice(0, limit).map(toUnitCard)
  }

  const ranked = catalog
    .map((u) => ({ u, score: scoreUnit(u, filters) }))
    .filter((row): row is { u: VoiceAssistCatalogUnit; score: number } => row.score != null)

  ranked.sort((a, b) => {
    if (filters.sort_pref === 'barato' || filters.sort_pref === 'caro') {
      const pa = a.u.price
      const pb = b.u.price
      if (pa == null && pb == null) return b.score - a.score
      if (pa == null) return 1
      if (pb == null) return -1
      const byPrice = filters.sort_pref === 'barato' ? pa - pb : pb - pa
      if (byPrice !== 0) return byPrice
      return b.score - a.score
    }
    return b.score - a.score || a.u.unit_number.localeCompare(b.u.unit_number, 'es', { numeric: true })
  })

  return ranked.slice(0, limit).map(({ u }) => toUnitCard(u))
}

/**
 * Cuando no hay coincidencia exacta (p. ej. 8 dormitorios), propone lo más cercano
 * disponible en el catálogo.
 */
export function suggestNearbyVoiceUnits(
  catalog: VoiceAssistCatalogUnit[],
  filters: VoiceAssistFilters,
  limit = 3,
): VoiceAssistUnitCard[] {
  const groups = filters.or_groups?.filter(Boolean) ?? []
  const branch =
    groups.length === 1
      ? groups[0]!
      : {
          category: filters.category,
          bedrooms: filters.bedrooms,
          bathrooms: filters.bathrooms,
        }

  const softScore = (u: VoiceAssistCatalogUnit): number | null => {
    if (filters.only_available !== false && !OFFERABLE.has(u.status)) return null
    const unitCat = resolveVoiceCategory(u)

    // Respetar categoría pedida; si no hay, no mezclar locales en pedidos residenciales.
    if (branch.category) {
      if (unitCat !== branch.category) return null
    } else if (branch.bedrooms != null || branch.bathrooms != null) {
      if (unitCat === 'local') return null
    }

    let score = 200

    if (branch.bedrooms != null && unitCat !== 'local') {
      if (u.bedrooms == null) score -= 40
      else {
        const dist = Math.abs(u.bedrooms - branch.bedrooms)
        score -= dist * 25
        // Preferir lo más cercano por debajo cuando piden de más (8 → 3 mejor que inventar).
        if (u.bedrooms < branch.bedrooms) score += 4
      }
    }

    if (branch.bathrooms != null && unitCat !== 'local') {
      if (u.bathrooms == null) score -= 12
      else {
        const dist = Math.abs(u.bathrooms - branch.bathrooms)
        score -= dist * 14
        if (u.bathrooms >= branch.bathrooms) score += 3
      }
    }

    if (filters.price_max != null && u.price != null) {
      if (u.price > filters.price_max) {
        const over = (u.price - filters.price_max) / Math.max(filters.price_max, 1)
        score -= Math.min(50, 20 + over * 40)
      } else score += 8
    }
    if (filters.price_min != null && u.price != null && u.price < filters.price_min) {
      score -= 15
    }

    if (filters.area_min_m2 != null && u.area_total_m2 != null) {
      if (u.area_total_m2 < filters.area_min_m2) score -= 18
      else score += 4
    }

    const floor = u.floor_number
    if (filters.floor_min != null || filters.floor_max != null) {
      if (floor == null) score -= 6
      else {
        if (filters.floor_min != null && floor < filters.floor_min) score -= (filters.floor_min - floor) * 4
        if (filters.floor_max != null && floor > filters.floor_max) score -= (floor - filters.floor_max) * 4
        if (
          (filters.floor_min == null || floor >= filters.floor_min) &&
          (filters.floor_max == null || floor <= filters.floor_max)
        ) {
          score += 6
        }
      }
    } else if (filters.floor_pref) {
      const range = floorPrefRange(filters.floor_pref)
      if (range && floor != null) {
        if (floor < range.min || floor > range.max) score -= 8
        else score += 6
      }
    }

    if (filters.typology_code) {
      if ((u.typology_code || '').toUpperCase() === filters.typology_code.toUpperCase()) score += 20
      else score -= 10
    }

    if (filters.sort_pref === 'barato' && u.price != null) score += Math.max(0, 30 - u.price / 20_000)
    if (filters.sort_pref === 'caro' && u.price != null) score += Math.min(30, u.price / 20_000)

    if (OFFERABLE.has(u.status)) score += 2
    return score
  }

  // Si el OR mixto no dio nada, intentar sugerencias por cada grupo y mezclar.
  if (groups.length > 1) {
    const perGroup = Math.max(1, Math.ceil(limit / groups.length))
    const picked: VoiceAssistCatalogUnit[] = []
    const seen = new Set<string>()
    for (const g of groups) {
      const branchFilters: VoiceAssistFilters = {
        ...filters,
        or_groups: null,
        category: g.category,
        bedrooms: g.bedrooms,
        bathrooms: g.bathrooms,
      }
      for (const card of suggestNearbyVoiceUnits(catalog, branchFilters, perGroup)) {
        if (seen.has(card.id)) continue
        seen.add(card.id)
        const unit = catalog.find((u) => u.id === card.id)
        if (unit) picked.push(unit)
        if (picked.length >= limit) break
      }
      if (picked.length >= limit) break
    }
    if (picked.length > 0) return picked.slice(0, limit).map(toUnitCard)
  }

  const ranked = catalog
    .map((u) => ({ u, score: softScore(u) }))
    .filter((row): row is { u: VoiceAssistCatalogUnit; score: number } => row.score != null)
    .sort((a, b) => b.score - a.score || a.u.unit_number.localeCompare(b.u.unit_number, 'es', { numeric: true }))

  return ranked.slice(0, limit).map(({ u }) => toUnitCard(u))
}

/** Ajusta filtros imposibles tras sugerir (p. ej. 8 dorm. → el máximo cercano sugerido). */
export function softenFiltersToSuggestions(
  filters: VoiceAssistFilters,
  suggestions: VoiceAssistUnitCard[],
): VoiceAssistFilters {
  if (suggestions.length === 0) return filters
  const next = { ...filters }

  if (next.bedrooms != null) {
    const beds = suggestions
      .map((s) => s.bedrooms)
      .filter((n): n is number => n != null && Number.isFinite(n))
    if (beds.length && !beds.includes(next.bedrooms)) {
      next.bedrooms = Math.max(...beds)
    }
  }
  if (next.bathrooms != null) {
    const baths = suggestions
      .map((s) => s.bathrooms)
      .filter((n): n is number => n != null && Number.isFinite(n))
    if (baths.length && !baths.some((b) => b >= (next.bathrooms as number))) {
      next.bathrooms = Math.max(...baths)
    }
  }
  if (next.price_max != null) {
    const prices = suggestions
      .map((s) => s.price)
      .filter((n): n is number => n != null && Number.isFinite(n))
    if (prices.length && prices.every((p) => p > (next.price_max as number))) {
      next.price_max = Math.max(...prices)
    }
  }
  return normalizeFilters(next)
}

function formatPriceSpoken(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null
  if (value >= 1_000_000) {
    const n = value / 1_000_000
    return n % 1 === 0 ? `${n} millones de dólares` : `${n.toFixed(1).replace('.', ',')} millones de dólares`
  }
  if (value >= 1000) return `${Math.round(value / 1000)} mil dólares`
  return `${Math.round(value)} dólares`
}

function describeUnitSpoken(u: VoiceAssistUnitCard) {
  const cat = resolveVoiceCategory(u)
  const bits: string[] = []
  if (cat === 'local') {
    bits.push('local comercial')
    if (u.area_total_m2 != null && Number.isFinite(u.area_total_m2)) {
      bits.push(`${Math.round(u.area_total_m2)} metros`)
    }
  } else {
    if (u.bedrooms != null && u.bedrooms > 0) {
      bits.push(u.bedrooms === 1 ? '1 dormitorio' : `${u.bedrooms} dormitorios`)
    }
    if (u.bathrooms != null && u.bathrooms > 0) {
      bits.push(u.bathrooms === 1 ? '1 baño' : `${u.bathrooms} baños`)
    }
    if (u.area_total_m2 != null && Number.isFinite(u.area_total_m2)) {
      bits.push(`${Math.round(u.area_total_m2)} metros`)
    }
  }
  if (u.floor) bits.push(`piso ${u.floor}`)
  else if (u.floor_number != null) bits.push(`piso ${u.floor_number}`)
  const price = formatPriceSpoken(u.price)
  if (price) bits.push(price)
  return bits.join(', ')
}

function needPhrase(filters: VoiceAssistFilters) {
  const bits: string[] = []
  const groups = filters.or_groups?.filter(Boolean) ?? []
  if (groups.length > 0) {
    for (const g of groups) {
      const parts: string[] = []
      if (g.category === 'local') parts.push('locales comerciales')
      else if (g.category === 'suite') parts.push('suites')
      else if (g.category === 'departamento') parts.push('departamentos')
      if (g.bedrooms != null) {
        parts.push(g.bedrooms === 1 ? '1 dormitorio' : `${g.bedrooms} dormitorios`)
      }
      if (g.bathrooms != null) {
        parts.push(g.bathrooms === 1 ? '1 baño' : `${g.bathrooms} baños`)
      }
      if (parts.length) bits.push(parts.join(' de '))
    }
  } else {
    if (filters.category === 'local') bits.push('locales comerciales')
    if (filters.category === 'suite') bits.push('suites')
    if (filters.category === 'departamento') bits.push('departamentos')
    if (filters.bathrooms != null) {
      bits.push(filters.bathrooms === 1 ? '1 baño' : `${filters.bathrooms} baños`)
    }
    if (filters.bedrooms != null) {
      bits.push(filters.bedrooms === 1 ? '1 dormitorio' : `${filters.bedrooms} dormitorios`)
    }
  }
  if (filters.floor_pref) bits.push(`piso ${filters.floor_pref}`)
  if (filters.floor_min != null && filters.floor_max != null && filters.floor_min === filters.floor_max) {
    bits.push(`piso ${filters.floor_min}`)
  }
  if (filters.price_max != null) {
    const p = formatPriceSpoken(filters.price_max)
    if (p) bits.push(`presupuesto hasta ${p}`)
  }
  if (filters.sort_pref === 'barato') bits.push('los más económicos')
  if (filters.sort_pref === 'caro') bits.push('las opciones de mayor valor')
  return bits
}

function pickDynamicIntro(seed: string, options: string[]): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i) * (i + 1)) % 997
  return options[hash % options.length]!
}

export function buildSpeakLine(
  matches: VoiceAssistUnitCard[],
  filters: VoiceAssistFilters,
  opts?: { suggested?: boolean },
): {
  speak: string
  follow_up: string | null
} {
  const needs = needPhrase(filters)
  const needHint = needs.length ? ` Coincide con ${needs.join(', ')}.` : ''
  const requested = needs.length ? needs.join(', ') : 'esas características'
  const mixed = (filters.or_groups?.length ?? 0) > 1
  const isLocal =
    !mixed &&
    (filters.category === 'local' || matches.every((m) => resolveVoiceCategory(m) === 'local'))
  const optionLines = (list: VoiceAssistUnitCard[]) =>
    list.map((m, index) => `Opción ${index + 1}: ${describeUnitSpoken(m)}.`).join(' ')
  const seed = `${filters.category ?? ''}|${filters.sort_pref ?? ''}|${matches.map((m) => m.id).join(',')}|${opts?.suggested ? 's' : 'e'}`
  const closeHint = voiceCloseHintLine()
  const chooseFollowUp =
    'Toque una opción o diga “opción 1”. Si no desea más información, diga gracias y cierro.'
  const chooseAsk =
    matches.length === 1
      ? '¿Quiere que la abramos, o prefiere otra búsqueda?'
      : matches.length === 2
        ? '¿Cuál desea ver: la opción 1 o la 2?'
        : `¿Cuál desea ver? Puede decir opción 1, 2 o ${matches.length}.`

  if (matches.length === 0) {
    if (filters.category === 'local' && !mixed) {
      return {
        speak: pickDynamicIntro(seed, [
          `No tengo locales comerciales con ${requested}. ¿Quiere que ajustemos el presupuesto o el piso?`,
          `Con ${requested} no tengo locales ahora. ¿Probamos otro presupuesto o ubicación?`,
        ]),
        follow_up: 'Puede pedir “locales más económicos” o un presupuesto.',
      }
    }
    return {
      speak: pickDynamicIntro(seed, [
        `No tengo unidades con ${requested}. ¿Quiere que probemos otro presupuesto, dormitorios o piso?`,
        `Con ${requested} no hay coincidencias en este momento. Dígame otro filtro y busco de nuevo.`,
      ]),
      follow_up: 'Indíqueme otro dato y busco de nuevo.',
    }
  }

  // Pedido imposible / sin exactas: reconocer y sugerir alternativas.
  if (opts?.suggested) {
    const intro = pickDynamicIntro(seed, [
      `No tengo opciones con ${requested}, pero le sugiero estas alternativas.`,
      `Con ${requested} no cuento ahora; sí le puedo sugerir estas opciones cercanas.`,
      `Eso no lo tengo con esas características. Le propongo estas alternativas.`,
    ])
    return {
      speak: `${intro} ${optionLines(matches)} ${chooseAsk}${closeHint}`,
      follow_up: chooseFollowUp,
    }
  }

  if (filters.sort_pref === 'barato' && matches.length >= 1) {
    const label = mixed
      ? 'opciones mixtas más accesibles'
      : isLocal
        ? 'locales más accesibles'
        : 'opciones más económicas'
    return {
      speak: `${pickDynamicIntro(seed, [
        `Con gusto, estas son las ${label}. Le muestro un adelanto de cada una.`,
        `Claro, le presento las ${label}, una por una.`,
      ])} ${optionLines(matches)} ${chooseAsk}${closeHint}`,
      follow_up: chooseFollowUp,
    }
  }

  if (filters.sort_pref === 'caro' && matches.length >= 1) {
    return {
      speak: `${pickDynamicIntro(seed, [
        'Con gusto, estas son las de mayor valor. Le muestro un adelanto de cada una.',
        'Perfecto, le presento las de mayor valor, una por una.',
      ])} ${optionLines(matches)} ${chooseAsk}${closeHint}`,
      follow_up: chooseFollowUp,
    }
  }

  if (matches.length === 1) {
    const desc = describeUnitSpoken(matches[0])
    const one = isLocal ? 'un local' : 'una opción'
    return {
      speak: `${pickDynamicIntro(seed, [
        `Encontré ${one} que puede servirle: ${desc}.`,
        `Tengo ${one} para usted: ${desc}.`,
      ])}${needHint} ${chooseAsk}${closeHint}`,
      follow_up: chooseFollowUp,
    }
  }

  const intro = needs.length
    ? pickDynamicIntro(seed, [
        `Perfecto. Con ${needs.join(' y ')}, le preparé estas opciones. Voy a mostrarle un adelanto de cada una.`,
        `Claro. Según ${needs.join(' y ')}, estas son buenas alternativas. Se las presento una por una.`,
      ])
    : pickDynamicIntro(seed, [
        `Perfecto. Le preparé ${matches.length} opciones. Voy a mostrarle un adelanto de cada una.`,
        `Con gusto. Aquí tiene ${matches.length} alternativas; se las presento una por una.`,
      ])

  return {
    speak: `${intro} ${optionLines(matches)} ${chooseAsk}${closeHint}`,
    follow_up: chooseFollowUp,
  }
}

/** Une el pedido actual con lo que ya había pedido el visitante. */
export function mergeVoiceFilters(
  previous: VoiceAssistFilters | null | undefined,
  next: VoiceAssistFilters,
): VoiceAssistFilters {
  if (!previous) return next
  // Pedido mixto nuevo reemplaza el simple anterior (y viceversa si viene plano).
  const or_groups = next.or_groups ?? previous.or_groups
  return normalizeFilters({
    bedrooms: next.bedrooms ?? previous.bedrooms,
    bathrooms: next.bathrooms ?? previous.bathrooms,
    floor_min: next.floor_min ?? previous.floor_min,
    floor_max: next.floor_max ?? previous.floor_max,
    floor_pref: next.floor_pref ?? previous.floor_pref,
    price_min: next.price_min ?? previous.price_min,
    price_max: next.price_max ?? previous.price_max,
    typology_code: next.typology_code ?? previous.typology_code,
    only_available: next.only_available !== false && previous.only_available !== false,
    area_min_m2: next.area_min_m2 ?? previous.area_min_m2,
    sort_pref: next.sort_pref ?? previous.sort_pref,
    category: next.or_groups ? null : (next.category ?? previous.category),
    or_groups,
  })
}

export function wantsFreshSearch(transcript: string) {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
  return /\b(de nuevo|otra busqueda|busca otra|olvid|reinicia|empezar de cero|borra|limpiar)\b/.test(t)
}

/** “opción 1”, “la primera”, “quiero la segunda”. Índice 1-based. */
export function parseOptionChoice(transcript: string): number | null {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const ordinal: Record<string, number> = {
    primera: 1,
    primero: 1,
    '1ra': 1,
    '1era': 1,
    segunda: 2,
    segundo: 2,
    '2da': 2,
    tercera: 3,
    tercero: 3,
    '3ra': 3,
    una: 1,
    uno: 1,
    dos: 2,
    tres: 3,
  }

  const byWord = t.match(
    /\b(?:opcion|opciones|la|el)?\s*(primera|primero|1ra|1era|segunda|segundo|2da|tercera|tercero|3ra)\b/,
  )
  if (byWord?.[1] && ordinal[byWord[1]] != null) return ordinal[byWord[1]]

  const byNum = t.match(
    /\b(?:opcion|opcion\s*n(?:ro|o)?\.?|la\s*opcion|quiero\s+(?:la\s+)?opcion|escoger|elegir|tomar|ver)\s*(?:numero\s*|n(?:ro|o)?\.?\s*|n[°º]?\s*)?([123])\b/,
  )
  if (byNum?.[1]) return Number(byNum[1])

  const bare = t.match(/^\s*(?:la\s+)?(?:opcion\s+)?([123]|una|uno|dos|tres|primera|primera|segunda|tercera)\s*$/)
  if (bare?.[1]) {
    if (ordinal[bare[1]] != null) return ordinal[bare[1]]
    const n = Number(bare[1])
    if (n >= 1 && n <= 3) return n
  }

  const quiero = t.match(
    /\b(?:quiero|dame|muestra|mostrar|abre|ver|escojo|elijo|me quedo con)\s+(?:la\s+)?(?:opcion\s+)?([123]|primera|primera|segundo|segunda|tercera|uno|una|dos|tres)\b/,
  )
  if (quiero?.[1]) {
    if (ordinal[quiero[1]] != null) return ordinal[quiero[1]]
    const n = Number(quiero[1])
    if (n >= 1 && n <= 3) return n
  }

  return null
}

/**
 * Confirma la opción listada: “opción 2”, o con una sola coincidencia “sí” / “ábrela”.
 */
export function parseListedOptionChoice(transcript: string, matchCount: number): number | null {
  if (matchCount < 1) return null
  const explicit = parseOptionChoice(transcript)
  if (explicit != null && explicit <= matchCount) return explicit
  if (matchCount !== 1) return null

  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || t.length > 48) return null
  if (
    /^(si|claro|dale|vamos|ok|okay|perfecto|de acuerdo|abriela|abrela|abrirla|esa|esta|ese|este|la quiero|me gusta|revisemos|hagamoslo)([!.,]*)?$/.test(
      t,
    )
  ) {
    return 1
  }
  if (/\b(abre(la|lo)?|quiero ver(la|lo)?|si quiero|dale abre|revisamos)\b/.test(t)) return 1
  return null
}

/** Cierre de conversación: “gracias”, “eso es todo”, “chao”, etc. */
export function isConversationEnd(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return false

  // Evitar falsos positivos en búsquedas (“listo, 2 baños”).
  if (
    /\b(dormitor|bano|piso|departamento|unidad|opcion|precio|metro|m2|busca|quiero un|quiero una)\b/.test(
      t,
    )
  ) {
    // Aun con filtros, despedida corta cuenta (“gracias”, “opción 2 gracias”).
    if (/^(ok\s+)?gracias(\s+mucho)?[!.,]*$/.test(t)) return true
    if (/^(muchas\s+)?gracias\b/.test(t) && t.length < 48) return true
    if (
      !/\b(gracias|chao|adios|nos vemos|hasta luego|eso es todo|ya esta|nada mas|listo gracias)\b/.test(
        t,
      )
    ) {
      return false
    }
  }

  if (
    /^(ok\s+)?(gracias|muchas gracias|mil gracias)(!|\.|\,)?(\s+(eso es todo|por ahora|igual))?[!.,]*$/.test(
      t,
    )
  ) {
    return true
  }
  if (
    /\b(gracias(\s+por\s+(todo|la ayuda|ayudarme))?|eso es todo|ya (esta|está)|nada mas|por ahora( es)? todo|terminamos|ya me sirve|me sirve asi|me quedo con (esta|esa)|perfecto asi|listo gracias|chao|adios|hasta luego|nos vemos|cierra( el asistente)?|puedes cerrar)\b/.test(
      t,
    )
  ) {
    return true
  }
  return false
}

/** Silencio, muletillas o audio sin contenido útil (no confundir con fuera de tema). */
export function isUnclearOrSilentSpeech(transcript: string): boolean {
  const t = String(transcript ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t) return true

  const stripped = t.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!stripped) return true
  if (stripped.length <= 2) return true

  if (
    /^(eh+|ah+|oh+|mm+|hmm+|uhm+|um+|em+|este+|estee+|aja+|ok|okay|sip|e+m+|m+\.?|a+\.?)$/.test(
      stripped,
    )
  ) {
    return true
  }
  if (/^(este|bueno|a ver|nada|no se|perdona|disculpa|espera)\.?$/.test(stripped)) {
    return true
  }
  // Alucinaciones típicas de Whisper con silencio / ruido.
  if (
    /\b(subtitulos?( realizados)?|subtitles?|subscribe|thanks for watching|gracias por ver|music|musica|applause|silence)\b/.test(
      stripped,
    )
  ) {
    return true
  }
  return false
}

/** Mensaje formal y cálido cuando no se entendió voz / hubo silencio. */
export function speakUnclearSpeechClarification(): { speak: string; follow_up: string } {
  return {
    speak:
      'Disculpe, no le escuché bien. Cuando guste, repítame con confianza qué busca: por ejemplo dormitorios, baños o presupuesto.',
    follow_up: 'Puede hablar o escribir aquí.',
  }
}

/** Normaliza un celular de Ecuador a dígitos (09… o +593…). */
function normalizeEcuadorMobileDigits(digits: string): string | null {
  let d = String(digits ?? '').replace(/\D/g, '')
  if (!d) return null
  // +593 9 XXXXXXXX
  if (d.startsWith('593') && d.length >= 11 && d.length <= 13 && d[3] === '9') {
    return `+${d}`
  }
  // 09XXXXXXXX
  if (d.length === 10 && d.startsWith('09')) return d
  // 9XXXXXXXX (sin cero)
  if (d.length === 9 && d.startsWith('9')) return `0${d}`
  // A veces pegan 0963608456 con código país sin +
  if (d.length === 12 && d.startsWith('5939')) return `+${d}`
  return null
}

/** Extrae un celular/WhatsApp dicho o escrito en el mensaje. */
export function parsePhoneFromTranscript(transcript: string): string | null {
  const raw = String(transcript ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return null

  // 1) Bloques que parecen teléfono (acepta guiones irregulares: 0963-6084-56).
  const looseRuns =
    raw.match(/(?:\+?\s*593[\s.-]*)?(?:0?\s*)?9(?:[\s.-]*\d){7,11}/g) || []
  for (const run of looseRuns) {
    const normalized = normalizeEcuadorMobileDigits(run)
    if (normalized) return normalized
  }

  // 2) Tras “mi número / WhatsApp es …”
  const labeled = raw.match(
    /(?:mi\s+)?(?:whats?app|numero|celular|telefono|cel)\s*(?:es|:)?\s*([+\d][\d\s.-]{7,18}\d)/,
  )
  if (labeled?.[1]) {
    const normalized = normalizeEcuadorMobileDigits(labeled[1])
    if (normalized) return normalized
  }

  // 3) Cualquier secuencia 09XXXXXXXX / 5939XXXXXXXX dentro del texto limpio.
  const allDigits = raw.replace(/\D/g, '')
  const local = allDigits.match(/09\d{8}/)
  if (local?.[0]) return local[0]
  const intl = allDigits.match(/5939\d{8}/)
  if (intl?.[0]) return `+${intl[0]}`
  const nine = allDigits.match(/(?:^|[^0-9])(9\d{8})(?:[^0-9]|$)/)
  if (nine?.[1]) return `0${nine[1]}`

  return null
}

/** El visitante ofrece dejar contacto sin dictar aún el número. */
export function wantsLeavePhone(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (parsePhoneFromTranscript(t)) return false
  return /\b(mi (whats?app|numero|celular|telefono)|te dejo mi|te paso mi|anota mi|guarda mi|registra?me|dejarte mi|dejar mi numero|quiero dejar mi)\b/.test(
    t,
  )
}

/** Respuesta corta afirmativa (p. ej. tras “¿desea dejar WhatsApp?”). */
export function isShortAffirmative(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(si|claro|dale|vamos|ok|okay|perfecto|de acuerdo|con gusto|por supuesto|esta bien|bueno)([!.,]*)?$/.test(
    t,
  )
}

/** Rechazo corto a dejar WhatsApp. */
export function isShortDecline(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  return /^(no|no gracias|ahora no|por ahora no|mejor no|despues|luego)([!.,]*)?$/.test(t)
}

const PHONE_ASK_SESSION_KEY = 'lv_voice_phone_asked_v5'

export function hasAskedVoicePhone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(PHONE_ASK_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function markAskedVoicePhone() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PHONE_ASK_SESSION_KEY, '1')
  } catch {
    /* ignore */
  }
}

/** Al elegir una unidad: preguntar WhatsApp si aún no está identificado. */
export function withSoftPhoneAsk(
  data: VoiceAssistResult,
  identified: boolean,
  opts?: { afterOptionPick?: boolean },
): VoiceAssistResult {
  if (!opts?.afterOptionPick) return data
  if (data.matches.length === 0) return data

  const close = voiceCloseHintLine()
  let speak = data.speak.replace(/\s+$/, '')
  if (speak.endsWith(close.trim())) {
    speak = speak.slice(0, -close.trim().length).replace(/\s+$/, '')
  }

  // Ya tiene WhatsApp: solo recuerda cómo cerrar.
  if (identified) {
    return {
      ...data,
      speak: `${speak}${close}`,
      follow_up:
        'Si no desea más información, diga gracias y cierro. También puede pedir otra opción u otro filtro.',
    }
  }

  // Cada vez que elige una opción (si aún no dejó número), preguntar WhatsApp.
  markAskedVoicePhone()
  return {
    ...data,
    speak: `${speak}${voiceSoftPhoneAskLine()}${close}`,
    follow_up:
      'Si desea, dígame su WhatsApp. Si no desea más información, diga gracias y cierro.',
  }
}

/** Temas ajenos al showroom (clima, chistes, política, etc.). */
export function isLikelyOffTopic(transcript: string): boolean {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || t.length < 2) return false
  if (isUnclearOrSilentSpeech(t)) return false
  if (isConversationEnd(t)) return false
  if (parsePhoneFromTranscript(t) || wantsLeavePhone(t)) return false
  if (parseOptionChoice(t) != null) return false
  if (parseUnitCodeMention(t)) return false
  if (filtersHaveSignal(parseVoiceFiltersLocal(t))) return false

  // Saludos / ayuda genérica corta: se redirige con tono amable, no como “tontería”.
  if (
    /^(hola|buenas|buen dia|buenos dias|buen[oa]s tardes|buen[oa]s noches|hey|hi|hello|que tal|como estas|ayuda|ayudame|me ayudas)[!?.]*$/.test(
      t,
    )
  ) {
    return false
  }

  if (isTourHousingCue(t)) return false

  if (
    /\b(chiste|broma|clima|tiempo (hace|hoy|manana)|llueve|futbol|futbol|partido|politica|eleccion|receta|cocinar|programar|codigo|javascript|python|chatgpt|inteligencia artificial|quien eres|de que equipo|capital de|matematica|tarea escolar|novia|novio|amor|sexo|porn|bitcoin|cripto|spotify|youtube|netflix|pelicula|serie|chisme|horoscopo|loteria)\b/.test(
      t,
    )
  ) {
    return true
  }

  // Frase con varias palabras y sin ninguna pista inmobiliaria.
  const words = t.split(/\s+/).filter(Boolean)
  return words.length >= 4
}

function isTourHousingCue(t: string): boolean {
  return /\b(dormitor|habitacion|bano|piso|departamento|depto|dpto|unidad|tipolog|presupuesto|precio|dolar|metro|m2|area|disponible|opcion|comparar|favorit|tour|galeria|acabado|lavilet|cuenca|vivienda|casa|apto|apartamento|suite|local(es)?|comercial(es)?|negocio|oficina|preventa|inversion|credito|financia|simulador|barat|econom|mas caro|premium|mostrar opciones|ver opciones|busco (depto|departamento|vivienda|casa|unidad|local)|buscar (depto|departamento|vivienda|casa|unidad|local)|tienes locales|hay locales)\b/.test(
    t,
  )
}

/** Aclara el rol del asistente y vuelve al tema del showroom. */
export function speakOffTopicClarification(transcript: string): {
  speak: string
  follow_up: string
} {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const softHelp = /^(hola|buenas|ayuda|ayudame|me ayudas|que puedes hacer|para que sirves)/.test(t)
  if (softHelp) {
    return {
      speak: `Con mucho gusto. Soy ${TOUR_VOICE_ASSISTANT_NAME}, de La Vilet. Puedo ayudarle con departamentos, suites o locales comerciales: dormitorios, baños, piso, presupuesto o un local. Pregúnteme lo que necesite: ¿por dónde le gustaría empezar?`,
      follow_up: 'Por ejemplo: “2 dormitorios”, “piso alto” o “locales comerciales”.',
    }
  }

  return {
    speak:
      'Con gusto le ayudo con el showroom de La Vilet: departamentos, suites y locales comerciales. ¿Qué le gustaría ver?',
    follow_up: 'Indíqueme un filtro y le muestro opciones.',
  }
}

export function speakPickedOption(card: VoiceAssistUnitCard, filters: VoiceAssistFilters): {
  speak: string
  follow_up: string | null
} {
  const desc = describeUnitSpoken(card)
  const needs = needPhrase(filters)
  const needHint = needs.length ? ` Encaja con lo que buscaba: ${needs.join(', ')}.` : ''
  return {
    speak: `Perfecto, le abro esta opción: ${desc}.${needHint} Si desea otra, solo dígamelo.`,
    follow_up: 'Indique un filtro o el número de opción.',
  }
}

/** “el 202”, “unidad 302”, “departamento 1104”. */
export function parseUnitCodeMention(transcript: string): string | null {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const patterns = [
    /\b(?:el|la|del|de la|unidad|departamento|depto|dpto|apto|apartamento|suite|local)\s*(?:numero\s*|n(?:ro|o)?\.?\s*)?(\d{2,4})\b/,
    /\b(?:quiero|ver|mira|muestra|mostrar|abre)\s+(?:el|la)?\s*(\d{2,4})\b/,
    /^\s*(\d{2,4})\s*$/,
  ]
  for (const re of patterns) {
    const m = t.match(re)
    if (m?.[1]) return m[1].replace(/^0+/, '') || m[1]
  }
  return null
}

export function normalizeUnitCode(value: string) {
  return String(value ?? '')
    .trim()
    .replace(/\D/g, '')
    .replace(/^0+/, '')
}

export function findCatalogUnitByCode(
  catalog: VoiceAssistCatalogUnit[],
  code: string,
): VoiceAssistCatalogUnit | null {
  const want = normalizeUnitCode(code)
  if (!want) return null
  return (
    catalog.find((u) => normalizeUnitCode(u.unit_number) === want) ??
    catalog.find((u) => normalizeUnitCode(u.unit_number).endsWith(want)) ??
    null
  )
}

export function toVoiceUnitCard(u: VoiceAssistCatalogUnit): VoiceAssistUnitCard {
  return {
    id: u.id,
    unit_number: u.unit_number,
    floor: u.floor,
    floor_number: u.floor_number,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    area_total_m2: u.area_total_m2,
    price: u.price,
    status: u.status,
    typology_code: u.typology_code,
    category: resolveVoiceCategory(u),
    blurb: unitBlurb(u),
  }
}

export function normalizeFilters(raw: Partial<VoiceAssistFilters> | null | undefined): VoiceAssistFilters {
  const n = (v: unknown) => {
    if (v == null || v === '') return null
    const num = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(num) ? num : null
  }
  const pref = raw?.floor_pref
  const sort = raw?.sort_pref
  const cat = raw?.category
  const category = cat === 'local' || cat === 'suite' || cat === 'departamento' ? cat : null

  const orRaw = Array.isArray(raw?.or_groups) ? raw!.or_groups! : null
  const or_groups =
    orRaw
      ?.map((g) => {
        const gc = g?.category
        const gCat = gc === 'local' || gc === 'suite' || gc === 'departamento' ? gc : null
        return {
          category: gCat,
          bedrooms: gCat === 'local' ? null : n(g?.bedrooms),
          bathrooms: gCat === 'local' ? null : n(g?.bathrooms),
        } satisfies VoiceAssistOrGroup
      })
      .filter((g) => g.category != null || g.bedrooms != null || g.bathrooms != null) ?? null

  const groups = or_groups && or_groups.length > 0 ? or_groups : null

  return {
    bedrooms: groups || category === 'local' ? null : n(raw?.bedrooms),
    bathrooms: groups || category === 'local' ? null : n(raw?.bathrooms),
    floor_min: n(raw?.floor_min),
    floor_max: n(raw?.floor_max),
    floor_pref: pref === 'bajo' || pref === 'medio' || pref === 'alto' ? pref : null,
    price_min: n(raw?.price_min),
    price_max: n(raw?.price_max),
    typology_code: raw?.typology_code ? String(raw.typology_code).trim() || null : null,
    only_available: raw?.only_available !== false,
    area_min_m2: n(raw?.area_min_m2),
    sort_pref: sort === 'barato' || sort === 'caro' ? sort : null,
    category: groups ? null : category,
    or_groups: groups,
  }
}

const WORD_NUM: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
}

function parseNumberToken(raw: string): number | null {
  const t = raw.trim().toLowerCase()
  if (WORD_NUM[t] != null) return WORD_NUM[t]
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseMoney(raw: string): number | null {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|m)\b/)
  if (mill) {
    const n = Number(mill[1].replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 1_000_000) : null
  }
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|k)\b/)
  if (mil) {
    const n = Number(mil[1].replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 1000) : null
  }
  const plain = t.match(/\$?\s*(\d{2,3}(?:[.,]\d{3})+|\d{4,7})\b/)
  if (plain) {
    const n = Number(plain[1].replace(/\./g, '').replace(',', ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Parser local: alcanza para “2 dormitorios / piso alto / hasta 180 mil” sin gastar cuota OpenAI. */
export function parseVoiceFiltersLocal(transcript: string): VoiceAssistFilters {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const filters = { ...EMPTY_VOICE_FILTERS }

  const wantsLocal = /\b(locales?(?:\s+comerciales?)?|local(?:\s+comercial)?|comerciales?|negocio|tienda|oficina)\b/.test(
    t,
  )
  const wantsSuite = /\bsuites?\b/.test(t)
  const wantsDepto = /\b(departamentos?|deptos?|dptos?|apartamentos?|aptos?|viviendas?)\b/.test(t)

  const bed =
    t.match(
      /(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)\s*(dormitorios?|habitacion(?:es)?|cuartos?)/,
    ) ||
    t.match(
      /(dormitorios?|habitacion(?:es)?|cuartos?)\s*(de\s*)?(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)/,
    )
  const bedN = bed ? parseNumberToken(bed[3] || bed[1]) : null

  const bath =
    t.match(/(\d+|un|uno|una|dos|tres|cuatro)\s*ba[nñ]os?/) ||
    t.match(/ba[nñ]os?\s*(de\s*)?(\d+|un|uno|una|dos|tres|cuatro)/)
  const bathN = bath ? parseNumberToken(bath[3] || bath[2] || bath[1]) : null

  // También: “departamentos de 1 habitación” (número después de “de”).
  const bedAfterDe =
    bedN == null
      ? t.match(
          /\b(?:departamento|depto|dpto|apartamento|apto|suite|vivienda)s?\s+de\s+(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)\s*(?:dormitorios?|habitacion(?:es)?|cuartos?)?/,
        )
      : null
  const bedResolved = bedN ?? (bedAfterDe ? parseNumberToken(bedAfterDe[1]) : null)

  // Mixtos: “locales y departamentos de 1 habitación”, “suites o locales”, etc.
  const categoryHits = [wantsLocal, wantsSuite, wantsDepto].filter(Boolean).length
  if (categoryHits >= 2 || (wantsLocal && (bedResolved != null || wantsDepto || wantsSuite))) {
    const groups: VoiceAssistOrGroup[] = []
    if (wantsLocal) groups.push({ category: 'local', bedrooms: null, bathrooms: null })
    if (wantsSuite) {
      groups.push({
        category: 'suite',
        bedrooms: bedResolved,
        bathrooms: bathN,
      })
    }
    if (wantsDepto || (wantsLocal && bedResolved != null && !wantsSuite && !wantsDepto)) {
      groups.push({
        category: 'departamento',
        bedrooms: bedResolved,
        bathrooms: bathN,
      })
    }
    if (groups.length >= 2) {
      filters.or_groups = groups
    } else if (groups.length === 1) {
      filters.category = groups[0]!.category
      filters.bedrooms = groups[0]!.bedrooms
      filters.bathrooms = groups[0]!.bathrooms
    }
  } else if (wantsLocal) {
    filters.category = 'local'
  } else if (wantsSuite) {
    filters.category = 'suite'
    if (bedResolved != null) filters.bedrooms = bedResolved
    if (bathN != null) filters.bathrooms = bathN
  } else if (wantsDepto) {
    filters.category = 'departamento'
    if (bedResolved != null) filters.bedrooms = bedResolved
    if (bathN != null) filters.bathrooms = bathN
  } else {
    if (bedResolved != null) filters.bedrooms = bedResolved
    if (bathN != null) filters.bathrooms = bathN
  }

  const floorNum = t.match(/piso(?:s)?\s*(\d{1,2})\b/) || t.match(/\bplanta\s*(\d{1,2})\b/)
  if (floorNum) {
    const n = Number(floorNum[1])
    if (Number.isFinite(n)) {
      filters.floor_min = n
      filters.floor_max = n
    }
  } else if (
    /\b(piso|planta)\s+(alto|altos|alta|altas)\b/.test(t) ||
    /\b(ultima|ultimo|azotea)\b/.test(t) ||
    (/\balto\b/.test(t) && /\bpiso\b/.test(t))
  ) {
    filters.floor_pref = 'alto'
  } else if (
    /\b(piso|planta)\s+(bajo|bajos|baja|bajas)\b/.test(t) ||
    /\bplanta baja\b/.test(t) ||
    (/\bbajo\b/.test(t) && /\bpiso\b/.test(t))
  ) {
    filters.floor_pref = 'bajo'
  } else if (/\b(piso|planta)\s+(medio|intermedio)\b/.test(t)) {
    filters.floor_pref = 'medio'
  }

  const until = t.match(/(hasta|maximo|m[aá]ximo|menos de|por debajo de|no mas de|no m[aá]s de)\s+([^,.]+)/)
  if (until) {
    const money = parseMoney(until[2])
    if (money != null) filters.price_max = money
  } else {
    const money = parseMoney(t)
    if (money != null && /(presupuesto|plata|dolares|d[oó]lares|usd|\$|mil|millon)/.test(t)) {
      filters.price_max = money
    }
  }

  if (/\b(disponible|disponibles|libres|en venta|preventa)\b/.test(t)) {
    filters.only_available = true
  }

  // “más barato / económico” y “más caro / premium”.
  if (
    /\b(mas barat|lo mas barat|el mas barat|la mas barat|barat[oa]s?|economicos?|economicas?|de menor precio|precio (bajo|accesible)|mas accesible|mas economico)\b/.test(
      t,
    )
  ) {
    filters.sort_pref = 'barato'
  } else if (
    /\b(mas caro|lo mas caro|el mas caro|la mas cara|premium|de lujo|mayor precio|mas exclusivo|mas costoso)\b/.test(
      t,
    )
  ) {
    filters.sort_pref = 'caro'
  }

  // Pedido abierto: mostrar algo útil (económicas) en vez de pedirle más datos.
  const hasHardSignal =
    filters.bedrooms != null ||
    filters.bathrooms != null ||
    filters.floor_min != null ||
    filters.floor_pref != null ||
    filters.price_min != null ||
    filters.price_max != null ||
    Boolean(filters.typology_code) ||
    filters.area_min_m2 != null ||
    filters.sort_pref != null ||
    filters.category != null ||
    (filters.or_groups?.length ?? 0) > 0
  if (
    !hasHardSignal &&
    /\b(departamento|depto|dpto|vivienda|apartamento|apto|opciones|muestrame|ensename|ver algo|algo disponible)\b/.test(
      t,
    )
  ) {
    filters.sort_pref = 'barato'
  }
  // “¿Tienes locales?” o mixtos → listar económicos de inmediato.
  if (
    (filters.category === 'local' || (filters.or_groups?.length ?? 0) > 0) &&
    filters.sort_pref == null &&
    filters.price_max == null
  ) {
    filters.sort_pref = 'barato'
  }

  return normalizeFilters(filters)
}

export function filtersHaveSignal(filters: VoiceAssistFilters): boolean {
  return (
    filters.bedrooms != null ||
    filters.bathrooms != null ||
    filters.floor_min != null ||
    filters.floor_max != null ||
    filters.floor_pref != null ||
    filters.price_min != null ||
    filters.price_max != null ||
    Boolean(filters.typology_code) ||
    filters.area_min_m2 != null ||
    filters.sort_pref != null ||
    filters.category != null ||
    (filters.or_groups?.length ?? 0) > 0
  )
}
