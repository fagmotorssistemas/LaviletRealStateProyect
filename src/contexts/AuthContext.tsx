'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AuthChangeEvent, User, Session, SupabaseClient } from '@supabase/supabase-js'

interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string | null
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, newSession: Session | null) => {
        if (initialized.current && event === 'TOKEN_REFRESHED') return

        setSession(newSession)
        setUser(newSession?.user ?? null)

        if (newSession?.user) {
          try {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', newSession.user.id)
              .single()
            setProfile(data)
          } catch {
            if (!initialized.current) setProfile(null)
          }
        } else {
          setProfile(null)
        }

        setIsLoading(false)
        initialized.current = true
      }
    )

    return () => subscription.unsubscribe()
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

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [supabase])

  const value = useMemo(
    () => ({ supabase, user, session, profile, isLoading }),
    [supabase, user, session, profile, isLoading]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
