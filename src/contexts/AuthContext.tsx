'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, User, Session, SupabaseClient } from '@supabase/supabase-js'
import { knownRole, normalizeCrmPaths } from '@/lib/inmobiliaria/roleAccess'
import type { UserRole } from '@/types/inmobiliaria'

interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole | null
  phone: string | null
  email: string | null
  crm_paths: string[] | null
}

interface AuthContextType {
  supabase: SupabaseClient
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

function profileFromUser(current: User): Profile {
  return {
    id: current.id,
    full_name: current.user_metadata?.full_name ?? null,
    avatar_url: current.user_metadata?.avatar_url ?? null,
    // El rol de autorización viene solo de profiles en DB.
    role: null,
    phone: current.user_metadata?.phone ?? null,
    email: current.email ?? null,
    crm_paths: normalizeCrmPaths(current.app_metadata?.crm_paths).length
      ? normalizeCrmPaths(current.app_metadata?.crm_paths)
      : null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [supabase] = useState(() => createClient())
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const userIdRef = useRef<string | null>(null)
  const applyGen = useRef(0)
  const applySessionRef = useRef<(next: Session | null) => Promise<void>>(async () => {})
  const skipPathSync = useRef(true)

  useEffect(() => {
    let cancelled = false

    const hydrateProfile = async (current: User): Promise<Profile | null> => {
      try {
        const response = await fetch('/api/me/profile', {
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        })
        if (response.ok) {
          const json = (await response.json()) as { profile?: Profile | null }
          if (json.profile) {
            return {
              ...json.profile,
              role: knownRole(json.profile.role),
              email: json.profile.email ?? current.email ?? null,
              crm_paths:
                normalizeCrmPaths(json.profile.crm_paths).length > 0
                  ? normalizeCrmPaths(json.profile.crm_paths)
                  : normalizeCrmPaths(current.app_metadata?.crm_paths).length > 0
                    ? normalizeCrmPaths(current.app_metadata?.crm_paths)
                    : null,
            }
          }
        }
      } catch (error) {
        console.error('No se pudo leer profiles', error)
      }
      try {
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url, role, phone')
          .eq('id', current.id)
          .maybeSingle()
        if (!data) return profileFromUser(current)
        return {
          id: current.id,
          full_name: data.full_name ?? current.user_metadata?.full_name ?? null,
          avatar_url: data.avatar_url ?? null,
          role: knownRole(data.role),
          phone: data.phone ?? current.user_metadata?.phone ?? null,
          email: current.email ?? null,
          crm_paths: normalizeCrmPaths(current.app_metadata?.crm_paths).length
            ? normalizeCrmPaths(current.app_metadata?.crm_paths)
            : null,
        }
      } catch (error) {
        console.error('No se pudo leer profiles', error)
        return profileFromUser(current)
      }
    }

    const applySession = async (next: Session | null) => {
      const gen = ++applyGen.current
      const nextUserId = next?.user?.id ?? null
      userIdRef.current = nextUserId
      setSession(next)
      setUser(next?.user ?? null)

      if (!next?.user) {
        setProfile(null)
        if (!cancelled && gen === applyGen.current) setIsLoading(false)
        return
      }

      setProfile((prev) => (prev?.id === next.user.id ? prev : profileFromUser(next.user)))
      setIsLoading(false)

      const nextProfile = await hydrateProfile(next.user)
      if (cancelled || gen !== applyGen.current || !nextProfile) return
      setProfile(nextProfile)
    }

    applySessionRef.current = applySession

    const recoverFromCookies = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser()
        if (cancelled) return
        if (!userData.user) {
          await applySession(null)
          return
        }
        const { data: sessionData } = await supabase.auth.getSession()
        if (cancelled) return
        await applySession(sessionData.session ?? ({ user: userData.user } as Session))
      } catch (error) {
        console.error('No se pudo recuperar la sesión', error)
        if (!cancelled) await applySession(null)
      }
    }

    void recoverFromCookies()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession: Session | null) => {
      if (event === 'TOKEN_REFRESHED') return
      const nextUserId = newSession?.user?.id ?? null
      if (event === 'INITIAL_SESSION') {
        if (nextUserId && nextUserId !== userIdRef.current) {
          await applySession(newSession)
        }
        return
      }
      await applySession(newSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

  useEffect(() => {
    if (skipPathSync.current) {
      skipPathSync.current = false
      return
    }
    let cancelled = false
    void supabase.auth.getSession().then(async ({ data }: { data: { session: Session | null } }) => {
      if (cancelled) return
      const cachedId = data.session?.user?.id ?? null
      if (cachedId && cachedId === userIdRef.current) return
      const { data: userData } = await supabase.auth.getUser()
      if (cancelled) return
      const nextId = userData.user?.id ?? null
      if (nextId === userIdRef.current) return
      if (!userData.user) {
        await applySessionRef.current(null)
        return
      }
      const { data: sessionData } = await supabase.auth.getSession()
      if (cancelled) return
      await applySessionRef.current(sessionData.session ?? ({ user: userData.user } as Session))
    }).catch((error: unknown) => {
      console.error('No se pudo sincronizar la sesión', error)
    })
    return () => {
      cancelled = true
    }
  }, [pathname, supabase])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.startAutoRefresh()
      } else {
        supabase.auth.stopAutoRefresh()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [supabase])

  const value = useMemo(
    () => ({ supabase, user, session, profile, isLoading }),
    [supabase, user, session, profile, isLoading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
