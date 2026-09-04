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
  const isVisitante = role === 'visitante'

  useEffect(() => {
    if (isLoading) return
    if (!user || isVisitante) router.replace(isVisitante ? '/cuenta' : '/login')
  }, [isLoading, user, isVisitante, router])

  if (!user || isVisitante) {
    return (
      <div className="flex min-h-[100dvh] flex-1 items-center justify-center bg-[#fcfbf9]">
        <Spinner size="lg" />
      </div>
    )
  }

  return children
}
