'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { LATER_ROUTES, type LaterConfig, type LaterWeek } from '@/lib/inmobiliaria/nutritionLater'
import { saveNutritionLaterAction } from '@/app/inmobiliaria/automatizacion/actions'

export function NutritionLaterSettings({ projectId, initial, updatedAt, onSaved }: {
  projectId: string; initial: Record<LaterWeek, LaterConfig>; updatedAt: string; onSaved: (config: Record<LaterWeek, LaterConfig>, updatedAt: string) => void
}) {
  const [enabled, setEnabled] = useState({ 2: initial[2].enabled, 3: initial[3].enabled })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const result = await saveNutritionLaterAction(projectId, enabled, updatedAt)
      onSaved(result.config, result.updatedAt)
      toast.success('Semanas 2 y 3 guardadas para los nuevos turnos atendidos.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5 text-sm text-[#3a3d36]">
    <p>Se programan a los 14 y 21 días sin respuesta. Se respeta un mínimo de siete días entre seguimientos; un mensaje aplazado puede desplazar el siguiente. Cada paso se envía como máximo una vez por contacto y proyecto.</p>
    {([2, 3] as const).map(week => <div key={week} className="space-y-3 rounded-xl border border-[#deded4] p-4">
      <label className="flex gap-2 font-semibold"><input type="checkbox" checked={enabled[week]} onChange={e => setEnabled({ ...enabled, [week]: e.target.checked })} />Activar día {week === 2 ? '14' : '21'}</label>
      <p>{week === 2 ? 'Invita a compartir una duda pendiente. La variable describe lo que busca: hogar, local, inversión o una opción por definir.' : 'Ofrece un siguiente paso pertinente: información de financiamiento, proceso de compra o conversación con un asesor. Si ya se ofreció o explicó, se busca otra opción útil; si no la hay, se omite el mensaje.'}</p>
      <details><summary className="cursor-pointer">Ver plantilla y conexión</summary><p className="mt-3 whitespace-pre-line">{LATER_ROUTES[week].body.replace('{{1}}', `[Nutricion_${week}s]`)}</p><p className="mt-2 text-xs">Salesbot {LATER_ROUTES[week].botId} · campo {LATER_ROUTES[week].fieldId}{week === 2 ? ' · incluye LaVilet.png' : ''}</p></details>
    </div>)}
    <p>Al responder el lead se cancelan los pendientes y se atiende lo que respondió. Un «sí» a información financiera no autoriza una solicitud de crédito. Se mantienen las pausas por cita, evaluación, atención humana y falta de permiso de seguimiento.</p>
    <p className="text-xs">La activación se aplica a los nuevos turnos atendidos y no crea mensajes retroactivos para conversaciones antiguas.</p>
    <Button disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar días 14 y 21'}</Button>
  </div>
}
