'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, User, Session, SupabaseClient } from '@supabase/supabase-js'
import type { UserRole } from '@/types/inmobiliaria'

interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: UserRole | null
  phone: string | null
  email: string | null
}

interface AuthContextType {
  supabase: SupabaseClient
  user: User | null
  session: Session | null
  profile: Profile | null
  isLoading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabase] = useState(() => createClient())
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const initialized = useRef(false)
  const userIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadProfileFromClient = async (): Promise<Profile | null> => {
      const { data: sessionData } = await supabase.auth.getUser()
      const current = sessionData.user
      if (!current) return null
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, phone')
        .eq('id', current.id)
        .maybeSingle()
      return {
        id: current.id,
        full_name: data?.full_name ?? current.user_metadata?.full_name ?? null,
        avatar_url: data?.avatar_url ?? null,
        role: (data?.role as UserRole | null) ?? null,
        phone: data?.phone ?? current.user_metadata?.phone ?? null,
        email: current.email ?? null,
      }
    }

    const loadProfile = async () => {
      try {
        const response = await fetch('/api/me/profile', { cache: 'no-store' })
        if (response.ok) {
          const json = (await response.json()) as { profile?: Profile | null }
          if (json.profile) return json.profile
        }
      } catch (error) {
        console.error('No se pudo leer profiles', error)
      }
      try {
        return await loadProfileFromClient()
      } catch (error) {
        console.error('No se pudo leer profiles', error)
        return null
      }
    }

    const applySession = async (next: Session | null) => {
      if (cancelled) return
      const nextUserId = next?.user?.id ?? null
      userIdRef.current = nextUserId
      setSession(next)
      setUser(next?.user ?? null)
      if (next?.user) {
        let nextProfile = await loadProfile()
        if (!nextProfile && !cancelled) {
          await new Promise((resolve) => setTimeout(resolve, 400))
          nextProfile = await loadProfile()
        }
        if (!cancelled) setProfile(nextProfile)
      } else {
        setProfile(null)
      }
      if (!cancelled) {
        setIsLoading(false)
        initialized.current = true
      }
    }

    void supabase.auth.getSession().then(({ data: sessionData }: { data: { session: Session | null } }) => {
      if (cancelled || initialized.current || !sessionData.session) return
      void applySession(sessionData.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, newSession: Session | null) => {
      if (event === 'TOKEN_REFRESHED' && initialized.current) return
      const nextUserId = newSession?.user?.id ?? null
      if (event === 'INITIAL_SESSION' && initialized.current && nextUserId === userIdRef.current) return
      await applySession(newSession)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

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
