'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/utils'

export type MarketingFormat = '1' | '2' | '3'
export type MarketingTheme = 'light' | 'dark' | '3'

const STORAGE_KEY = 'lavilet-mkt-theme'
const FORMATS: MarketingFormat[] = ['1', '2', '3']

const ThemeCtx = createContext<{
  format: MarketingFormat
  theme: MarketingTheme
  setFormat: (format: MarketingFormat) => void
  toggle: () => void
}>({
  format: '1',
  theme: 'dark',
  setFormat: () => {},
  toggle: () => {},
})

export function useMarketingTheme() {
  return useContext(ThemeCtx)
}

function themeFromFormat(format: MarketingFormat): MarketingTheme {
  if (format === '1') return 'dark'
  if (format === '2') return 'light'
  return '3'
}

function parseStored(raw: string | null): MarketingFormat {
  if (raw === '1' || raw === 'dark') return '1'
  if (raw === '2' || raw === 'light') return '2'
  if (raw === '3') return '3'
  return '1'
}

export function MarketingThemeProvider({ children }: { children: ReactNode }) {
  const [format, setFormatState] = useState<MarketingFormat>('1')
  const theme = themeFromFormat(format)

  useEffect(() => {
    setFormatState(parseStored(window.localStorage.getItem(STORAGE_KEY)))
  }, [])

  const setFormat = useCallback((next: MarketingFormat) => {
    setFormatState(next)
    window.localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const toggle = useCallback(() => {
    setFormatState((current) => {
      const idx = FORMATS.indexOf(current)
      const next = FORMATS[(idx + 1) % FORMATS.length] ?? '1'
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return (
    <ThemeCtx.Provider value={{ format, theme, setFormat, toggle }}>
      <div
        data-mkt-theme={theme}
        className="min-h-screen bg-[var(--mkt-bg)] font-serif text-[var(--mkt-fg)] transition-colors duration-500"
      >
        {children}
      </div>
    </ThemeCtx.Provider>
  )
}

export function ThemeToggle({ className }: { className?: string }) {
  // Ya no mostramos los botones 1 y 2, forzamos el formato 3
  const { format, setFormat } = useMarketingTheme()
  
  // Si por alguna razón no está en formato 3, lo forzamos silenciosamente
  useEffect(() => {
    if (format !== '3') {
      setFormat('3')
    }
  }, [format, setFormat])

  return null // No renderizamos nada
}
