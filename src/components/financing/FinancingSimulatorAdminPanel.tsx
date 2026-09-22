'use client'

import { useCallback, useEffect, useState } from 'react'
import { FinancingSettingsView } from '@/components/financing/FinancingSettingsView'
import { FinancingAnalyticsView } from '@/components/financing/FinancingAnalyticsView'
import type { FinancingScenario } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { useRoleAccess } from '@/hooks/useRoleAccess'

/** Panel admin del simulador público: una sola vista responsive, bloques al mismo nivel. */
export function FinancingSimulatorAdminPanel() {
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const [scenarios, setScenarios] = useState<FinancingScenario[] | null>(null)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const loadOverview = useCallback(async () => {
    setOverviewError(null)
    try {
      const res = await fetch('/api/financing/admin/overview', { credentials: 'same-origin' })
      const json = (await res.json()) as {
        scenarios?: FinancingScenario[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || 'No se pudo cargar analytics')
      setScenarios(json.scenarios ?? [])
    } catch (error) {
      console.error(error)
      setScenarios([])
      setOverviewError(error instanceof Error ? error.message : 'Error al cargar')
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void loadOverview()
  }, [isAdmin, loadOverview])

  const overviewLoading = roleLoading || !isAdmin || scenarios == null

  return (
    <div className="space-y-4 sm:space-y-6">
      <p className="max-w-3xl text-sm leading-relaxed text-[#6b645c]">
        Configuración del simulador que ven los clientes en{' '}
        <a href="/simulador" className="font-medium text-[#1a2744] underline" target="_blank" rel="noreferrer">
          /simulador
        </a>
        .
      </p>

      <div className="grid gap-4 sm:gap-6">
        <FinancingSettingsView embedded />
        {overviewError ? (
          <p className="text-sm text-[#8a5c58]">{overviewError}</p>
        ) : null}
        {overviewLoading ? (
          <div className="flex min-h-[12vh] items-center justify-center">
            <Spinner size="lg" />
          </div>
        ) : (
          <FinancingAnalyticsView embedded scenarios={scenarios} />
        )}
      </div>
    </div>
  )
}
