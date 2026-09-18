'use client'

import { useState } from 'react'
import { FinancingSettingsView } from '@/components/financing/FinancingSettingsView'
import { FinancingAnalyticsView } from '@/components/financing/FinancingAnalyticsView'
import { FinancingAuditLogView } from '@/components/financing/FinancingAuditLogView'
import { cn } from '@/lib/utils'

type AdminSection = 'bancos' | 'configuracion' | 'analytics' | 'auditoria'

const SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'bancos', label: 'Bancos' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'auditoria', label: 'Auditoría' },
]

/** Panel admin del simulador público: una sola fila de secciones (sin pestañas anidadas). */
export function FinancingSimulatorAdminPanel() {
  const [section, setSection] = useState<AdminSection>('bancos')

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6b645c]">
        Configuración del simulador que ven los clientes en{' '}
        <a href="/simulador" className="font-medium text-[#1a2744] underline" target="_blank" rel="noreferrer">
          /simulador
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Secciones del simulador">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={section === item.id}
            onClick={() => setSection(item.id)}
            className={cn(
              'rounded-full px-4 py-2 text-[11px] font-semibold tracking-[0.14em] uppercase transition-colors',
              section === item.id
                ? 'bg-[#1a2744] text-white'
                : 'bg-white text-[#4a433c] ring-1 ring-[#e4ddd3] hover:bg-[#faf7f2]',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      {section === 'bancos' ? <FinancingSettingsView embedded section="partners" /> : null}
      {section === 'configuracion' ? <FinancingSettingsView embedded section="config" /> : null}
      {section === 'analytics' ? <FinancingAnalyticsView embedded /> : null}
      {section === 'auditoria' ? <FinancingAuditLogView embedded /> : null}
    </div>
  )
}
