'use client'

import type { LeadPipelineIssue } from '@/types/leadPipeline'

export function LeadPipelineWarnings({ warnings = [], issues = [], onRetry, loading = false }: {
  warnings?: string[]; issues?: LeadPipelineIssue[]; onRetry: () => void; loading?: boolean
}) {
  if (!warnings.length && !issues.length) return null
  const explained = new Set(issues.map(issue => `${issue.label}: ${issue.message}`))
  const additional = [...new Set(warnings)].filter(warning => !explained.has(warning))
  return <div role="status" className="rounded-xl border border-[#BDA27E]/40 bg-[#faf5eb] p-4 text-sm text-[#75613f]">
    <p className="font-semibold">Algunas secciones no pudieron cargarse</p>
    <p className="mt-1">La ficha y las cifras pueden estar incompletas. Una consulta fallida no confirma que no existan registros.</p>
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">Ver secciones y diagnóstico</summary>
      <ul className="mt-2 space-y-3">
        {issues.map(issue => <li key={`${issue.source}-${issue.reference}`}>
          <p><strong>{issue.label}:</strong> {issue.message}</p>
          <p className="mt-1 break-words text-xs">Referencia: {issue.reference}{issue.code ? ` · Código: ${issue.code}` : ''}</p>
        </li>)}
        {additional.map(warning => <li key={warning}>{warning}</li>)}
      </ul>
    </details>
    <button type="button" disabled={loading} onClick={onRetry} className="mt-3 rounded-lg border border-[#BDA27E]/60 px-3 py-1.5 font-medium disabled:opacity-50">{loading ? 'Consultando…' : 'Reintentar carga'}</button>
  </div>
}
