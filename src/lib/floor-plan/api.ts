import type { AnalysisResult } from '@/lib/floor-plan/types'

const MAX_CLIENT_BYTES = 20 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/bmp'])

export function validatePlanFile(file: File): string | null {
  if (!file) return 'Seleccioná una imagen'
  if (!ALLOWED.has(file.type) && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name)) {
    return 'Formato no soportado. Usá JPG, PNG, WEBP o BMP.'
  }
  if (file.size > MAX_CLIENT_BYTES) return 'Imagen demasiado grande (máx. 20MB).'
  return null
}

export async function analyzePlan(file: File, signal?: AbortSignal): Promise<AnalysisResult> {
  const err = validatePlanFile(file)
  if (err) {
    return {
      success: false,
      image: { width: 0, height: 0 },
      apartments: [],
      commonAreas: [],
      labels: [],
      error: err,
    }
  }

  const body = new FormData()
  body.append('image', file)

  const res = await fetch('/api/analyze-plan', {
    method: 'POST',
    body,
    signal,
  })

  const data = (await res.json().catch(() => null)) as AnalysisResult | { error?: string; success?: boolean } | null
  if (!res.ok || !data || data.success === false) {
    return {
      success: false,
      image: { width: 0, height: 0 },
      apartments: [],
      commonAreas: [],
      labels: [],
      error: (data && 'error' in data && data.error) || `Error ${res.status}`,
    }
  }
  return data as AnalysisResult
}

export function polygonToSvgPoints(polygon: [number, number][]): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(' ')
}
