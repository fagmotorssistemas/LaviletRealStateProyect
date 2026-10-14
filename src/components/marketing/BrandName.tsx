import type { ReactNode } from 'react'

export function BrandMacron({ uppercase = false }: { uppercase?: boolean }) {
  return <span className="lv-brand-e">{uppercase ? 'E' : 'e'}</span>
}

export function BrandLetter({ letter }: { letter: string }) {
  return letter === 'ē' || letter === 'Ē' ? <BrandMacron uppercase={letter === 'Ē'} /> : letter
}

export function BrandName({ compact = false, uppercase = false }: { compact?: boolean; uppercase?: boolean }) {
  const prefix: ReactNode = uppercase ? 'LA VIL' : compact ? 'LaVil' : 'La Vil'
  return (
    <span className="lv-display" role="img" aria-label="La Vilēt">
      {prefix}<BrandMacron uppercase={uppercase} />{uppercase ? 'T' : 't'}
    </span>
  )
}
