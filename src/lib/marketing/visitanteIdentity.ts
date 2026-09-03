export const TOUR_INTEREST_OPTIONS = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'local', label: 'Local comercial' },
  { value: 'inversion', label: 'Inversión / preventa' },
  { value: 'otro', label: 'Aún no lo tengo claro' },
] as const

export function normalizePhone(raw: string): string {
  return String(raw ?? '').replace(/\D/g, '')
}

export function normalizeEmail(raw: string): string {
  return String(raw ?? '').trim().toLowerCase()
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw))
}

export function interestLabel(value: string): string {
  return TOUR_INTEREST_OPTIONS.find((item) => item.value === value)?.label ?? value
}
