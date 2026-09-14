'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MarketingTheme = 'light' | 'dark'

const STORAGE_KEY = 'lavilet-mkt-theme'

const ThemeCtx = createContext<{
  theme: MarketingTheme
  toggle: () => void
}>({ theme: 'dark', toggle: () => {} })

export function useMarketingTheme() {
  return useContext(ThemeCtx)
}

export function MarketingThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<MarketingTheme>('dark')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') setTheme(stored)
  }, [])

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <div
        data-mkt-theme={theme}
        className="min-h-screen overflow-x-hidden bg-[var(--mkt-bg)] text-[var(--mkt-fg)] transition-colors duration-500"
      >
        {children}
      </div>
    </ThemeCtx.Provider>
  )
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useMarketingTheme()
  const dark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors',
        className,
      )}
    >
      {dark ? <Sun size={18} strokeWidth={1.75} /> : <Moon size={18} strokeWidth={1.75} />}
    </button>
  )
}
