'use client'

import { useId, useState } from 'react'
import type { LeadProfileCardData } from '@/lib/inmobiliaria/leadProfileCard'
import type { FinancingReviewInput } from '@/lib/inmobiliaria/financingReviewResult'
import { saveFinancingReview } from '@/app/inmobiliaria/automatizacion/financing-review-actions'

export function LeadProfileCard({ data, leadId }: { data: LeadProfileCardData; leadId: string }) {
  const formId = useId()
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [updatedAt, setUpdatedAt] = useState(data.leadUpdatedAt)
  return <div className="space-y-5">
    <p className="text-sm text-[#6e716b]">Datos guardados del lead. «Sin confirmar» indica que todavía falta información, no una respuesta negativa.</p>
    {data.groups.map(group => <section key={group.title} className="rounded-lg border border-[#dbe2d3] bg-[#fcfdf9] p-4">
      <h3 className="mb-3 text-lg font-semibold text-[#42523d]">{group.title}</h3>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{group.fields.map(field => <div key={field.label} className="min-w-0">
        <dt className="text-xs text-[#6e716b]">{field.label}</dt>
        <dd className="mt-1 break-words text-sm text-[#363d32]">{field.value}</dd>
      </div>)}</dl>
    </section>)}
    {data.selectedUnitId && data.financingAccepted && <details className="rounded-lg border border-[#dbe2d3] p-4">
      <summary className="cursor-pointer font-semibold text-[#42523d]">Registrar resultado de la revisión financiera</summary>
      <p className="my-3 text-sm text-[#6e716b]">Registre el resultado comprobado por el equipo para la unidad {data.selectedUnitNumber || 'elegida'}. Completar los datos o una simulación no acredita aprobación. Un resultado favorable con cobertura suficiente permite ofrecer iniciar la reserva; no reserva el inmueble ni envía mensajes.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={async event => {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        setSaving(true); setNotice('')
        try {
          const result = await saveFinancingReview(leadId, data.selectedUnitId!, updatedAt, {
            result: String(values.get('result')) as FinancingReviewInput['result'], ownFunds: Number(values.get('ownFunds')),
            financingAmount: Number(values.get('financingAmount')), note: String(values.get('note')),
          })
          setUpdatedAt(result.updatedAt); setNotice('Resultado guardado. Vuelva a abrir la ficha para actualizar su resumen.')
        } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo guardar.') }
        finally { setSaving(false) }
      }}>
        <div className="text-sm"><label htmlFor={`${formId}-result`}>Resultado</label><select id={`${formId}-result`} name="result" defaultValue={String(data.review.result || 'pending')} className="mt-1 w-full rounded border p-2">
          <option value="pending">Pendiente</option><option value="favorable">Favorable</option><option value="unfavorable">No favorable</option>
        </select></div>
        <label className="text-sm">Aporte propio revisado (USD)<input name="ownFunds" type="number" min="0" step="0.01" required defaultValue={String(data.review.own_funds ?? '')} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm">Financiamiento revisado (USD)<input name="financingAmount" type="number" min="0" step="0.01" required defaultValue={String(data.review.financing_amount ?? '')} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm sm:col-span-2">Resultado y respaldo de la revisión<textarea name="note" required minLength={10} maxLength={1000} defaultValue={String(data.review.note || '')} className="mt-1 w-full rounded border p-2" /></label>
        <button disabled={saving} className="rounded bg-[#506446] px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar resultado'}</button>
        {notice && <p role="status" className="text-sm sm:col-span-2">{notice}</p>}
      </form>
    </details>}
  </div>
}
