'use client'

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { translateTourText, type TourLocale } from './tourMessages'

const Context = createContext<{ locale: TourLocale; setLocale: (value: TourLocale) => void }>({ locale: 'es', setLocale: () => {} })
const STORAGE_KEY = 'lavilet_showroom_language'
const LANGUAGE_EVENT = 'lavilet:showroom-language'

function snapshot(): TourLocale {
  const query = new URL(window.location.href).searchParams.get('lang')
  if (query === 'en' || query === 'es') return query
  try { return window.localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'es' } catch { return 'es' }
}
function subscribe(listener: () => void) {
  window.addEventListener(LANGUAGE_EVENT, listener)
  window.addEventListener('storage', listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener(LANGUAGE_EVENT, listener)
    window.removeEventListener('storage', listener)
    window.removeEventListener('popstate', listener)
  }
}
function setLocale(value: TourLocale) {
  try { window.localStorage.setItem(STORAGE_KEY, value) } catch { /* URL still persists the choice. */ }
  const url = new URL(window.location.href)
  url.searchParams.set('lang', value)
  window.history.replaceState(window.history.state, '', url)
  window.dispatchEvent(new Event(LANGUAGE_EVENT))
}

/** Scope is the showroom, including its dialogs; the CRM language is unaffected. */
export function TourLocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<TourLocale>(subscribe, snapshot, () => 'es')
  return <Context.Provider value={{ locale, setLocale }}>{children}</Context.Provider>
}

export function useTourLanguage() {
  const context = useContext(Context)
  const t = useCallback(<T extends ReactNode,>(value: T): T => {
    return (typeof value === 'string' ? translateTourText(value, context.locale) : value) as T
  }, [context.locale])
  return { ...context, t }
}
