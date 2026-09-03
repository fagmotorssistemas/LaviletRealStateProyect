'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { homePathForRole, knownRole } from '@/lib/inmobiliaria/roleAccess'

export function CuentaGate({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading } = useAuth()
  const router = useRouter()
  const role = knownRole(profile?.role)

  useEffect(() => {
    if (isLoading) return
    if (!user) {
      router.replace('/login?next=/cuenta')
      return
    }
    if (role && role !== 'visitante') {
      router.replace(homePathForRole(role))
    }
  }, [isLoading, user, role, router])

  if (isLoading || !user || (role && role !== 'visitante')) {
    return <div className="min-h-screen bg-[#f7f3ee]" />
  }

  return children
}
