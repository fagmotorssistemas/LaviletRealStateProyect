'use client'

import { useState } from 'react'
import { FinancingSettingsView } from '@/components/financing/FinancingSettingsView'
import { FinancingAnalyticsView } from '@/components/financing/FinancingAnalyticsView'
import { FinancingAuditLogView } from '@/components/financing/FinancingAuditLogView'
import { cn } from '@/lib/utils'

type AdminSubTab = 'ajustes' | 'analytics' | 'auditoria'

const SUB_TABS: { id: AdminSubTab; label: string }[] = [
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'auditoria', label: 'Auditoría' },
]

/** Panel admin del simulador público: una sola pestaña en Financiamiento. */
export function FinancingSimulatorAdminPanel() {
  const [subTab, setSubTab] = useState<AdminSubTab>('ajustes')

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b645c]">
        Configuración del simulador que ven los clientes en{' '}
        <a href="/simulador" className="font-medium text-[#1a2744] underline" target="_blank" rel="noreferrer">
          /simulador
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-2">
        {SUB_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSubTab(item.id)}
            className={cn(
              'rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors',
              subTab === item.id
                ? 'bg-[#1a2744] text-white'
                : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3] hover:bg-[#faf7f2]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {subTab === 'ajustes' ? <FinancingSettingsView embedded /> : null}
      {subTab === 'analytics' ? <FinancingAnalyticsView embedded /> : null}
      {subTab === 'auditoria' ? <FinancingAuditLogView embedded /> : null}
    </div>
  )
}
