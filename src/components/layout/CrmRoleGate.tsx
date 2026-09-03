'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { knownRole } from '@/lib/inmobiliaria/roleAccess'
import { Spinner } from '@/components/ui/Spinner'

export function CrmRoleGate({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading } = useAuth()
  const router = useRouter()
  const role = knownRole(profile?.role)
  const waitingProfile = Boolean(user) && !profile && isLoading
  const isVisitante = role === 'visitante'

  useEffect(() => {
    if (isLoading || waitingProfile) return
    if (!user || isVisitante) router.replace(isVisitante ? '/cuenta' : '/login')
  }, [isLoading, waitingProfile, user, isVisitante, router])

  if (isLoading || waitingProfile || !user || isVisitante) {
    return (
      <div className="flex min-h-[100dvh] flex-1 items-center justify-center bg-[#fcfbf9]">
        <Spinner size="lg" />
      </div>
    )
  }

  return children
}
