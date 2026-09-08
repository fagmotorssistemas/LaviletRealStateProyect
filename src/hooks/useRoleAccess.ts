'use client'

import { useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import {
  canAccessPath,
  canManageUsers,
  canWriteCrm,
  isAdminRole,
  normalizeRole,
} from '@/lib/inmobiliaria/roleAccess'

export function useRoleAccess() {
  const { profile, isLoading } = useAuth()
  const role = normalizeRole(profile?.role)
  const crmPaths = profile?.crm_paths ?? null

  return useMemo(
    () => ({
      role,
      isLoading,
      isAdmin: isAdminRole(role),
      canWrite: canWriteCrm(role),
      canManageUsers: canManageUsers(role),
      canAccess: (pathname: string) => canAccessPath(role, pathname, crmPaths),
    }),
    [role, crmPaths, isLoading],
  )
}
