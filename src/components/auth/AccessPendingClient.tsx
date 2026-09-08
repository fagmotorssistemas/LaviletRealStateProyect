'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { isAccessPending } from '@/lib/auth/accessPending'
import { homePathForRole } from '@/lib/inmobiliaria/roleAccess'
import { Spinner } from '@/components/ui/Spinner'

/** Si el admin ya aprobó, saca al usuario de la pantalla de espera. */
export function AccessPendingClient() {
  const { user, profile, isLoading, supabase } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/login')
      return
    }
    if (!isAccessPending(user)) {
      router.replace(homePathForRole(profile?.role, profile?.crm_paths))
    }
  }, [isLoading, user, profile, router])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => {
      void supabase.auth.refreshSession()
    }, 20000)
    return () => window.clearInterval(timer)
  }, [user, supabase])

  if (isLoading || !user) {
    return (
      <div className="mt-6 flex justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <p className="mt-6 text-xs tracking-wide text-[#8a8d87]">
      Esta página se actualiza sola cuando te den acceso.
    </p>
  )
}
