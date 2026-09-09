'use client'

/**
 * Estilo de muestra para terminaciones sin swatch_url.
 */
export function finishSwatchStyle(slug: string, name: string): string {
  const key = `${slug}-${name}`.toLowerCase()
  if (key.includes('japandi') || key.includes('nogal') || key.includes('wood') || key.includes('madera')) {
    return 'linear-gradient(135deg,#c4a574 0%,#8b6914 45%,#5c4033 100%)'
  }
  if (key.includes('moderno') || key.includes('modern') || key.includes('claro') || key.includes('white')) {
    return 'linear-gradient(135deg,#f5f0e8 0%,#d9d2c5 50%,#b8b0a4 100%)'
  }
  if (key.includes('industrial') || key.includes('oscuro') || key.includes('dark') || key.includes('black')) {
    return 'linear-gradient(135deg,#6b5b4f 0%,#3d342c 55%,#1f1a16 100%)'
  }
  if (key.includes('roble') || key.includes('oak')) {
    return 'linear-gradient(135deg,#e0c9a0 0%,#b8956a 50%,#8a6a42 100%)'
  }
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  const h = hash % 360
  return `linear-gradient(135deg,hsl(${h} 28% 62%),hsl(${h} 32% 38%))`
}
