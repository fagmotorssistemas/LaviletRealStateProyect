/** Tipología de locales: solo galería de renders, sin 360 ni comparador. */
export function isLocalesTypologyName(value: string | null | undefined): boolean {
  const text = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
  return text === 'locales' || text.startsWith('locales ')
}

export function isGalleryOnlyTypology(
  input: { category?: string | null; code?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!input) return false
  if ((input.category ?? '').trim().toLowerCase() === 'local') return true
  return isLocalesTypologyName(input.code) || isLocalesTypologyName(input.name)
}

/** "planta 1" → "Locales planta 1". Si ya empieza por Locales, se respeta. */
export function localesTypologyName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  if (!trimmed) throw new Error('Escribí el nombre, por ejemplo Locales planta 1')
  const name = isLocalesTypologyName(trimmed) ? trimmed : `Locales ${trimmed}`
  if (name.length > 80) throw new Error('El nombre es demasiado largo')
  return name
}

export function localesTypologySlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'locales'
  )
}
