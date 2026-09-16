'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { saveNutritionWeekOneAction, markBrochureSharedAction } from '@/app/inmobiliaria/automatizacion/actions'
import { WEEK_ONE_ROUTES, type NutritionWeekOneConfig } from '@/lib/inmobiliaria/nutritionWeekOne'

export function NutritionWeekOneSettings({ projectId, initial, updatedAt, onSaved }: {
  projectId: string; initial: NutritionWeekOneConfig; updatedAt: string; onSaved: (config: NutritionWeekOneConfig, updatedAt: string) => void
}) {
  const [config, setConfig] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [leadId, setLeadId] = useState('')
  const save = async () => {
    setBusy(true)
    try {
      const result = await saveNutritionWeekOneAction(projectId, config, updatedAt)
      onSaved(result.config, result.updatedAt)
      toast.success(result.config.enabled ? 'Semana 1 activada para los nuevos turnos atendidos.' : 'Semana 1 desactivada.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.') }
    finally { setBusy(false) }
  }
  const mark = async () => {
    setBusy(true)
    try {
      await markBrochureSharedAction(projectId, Number(leadId))
      toast.success('Entrega registrada. No se repetirá el brochure en la semana 1.')
      setLeadId('')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo registrar.') }
    finally { setBusy(false) }
  }
  return <div className="space-y-5 text-sm text-[#3a3d36]">
    <p>Tras siete días sin respuesta, comparte el brochure si el contacto todavía no lo recibió. Si ya se compartió, ofrece un siguiente paso relacionado con la conversación. Se elige un solo mensaje.</p>
    <label className="flex gap-2 font-semibold"><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />Activar semana 1</label>
    <label className="flex gap-2"><input type="checkbox" checked={config.brochureEnabled} onChange={e => setConfig({ ...config, brochureEnabled: e.target.checked })} />Compartir el brochure cuando aún no se haya enviado</label>
    <label className="block">Cuando ya se compartió el brochure
      <select className="crm-field mt-2 block w-full" value={config.alreadyShared} onChange={e => setConfig({ ...config, alreadyShared: e.target.value as 'relevant' | 'skip' })}>
        <option value="relevant">Enviar seguimiento si hay un tema relevante</option><option value="skip">Omitir el mensaje de semana 1</option>
      </select>
    </label>
    <fieldset className="space-y-3 rounded-xl border border-[#deded4] p-4"><legend className="px-2 font-semibold">Temas permitidos para el seguimiento</legend>
      {([['unitDetails', 'Distribución del inmueble de interés'], ['comparison', 'Comparación de opciones disponibles'], ['financing', 'Información sobre financiamiento'], ['visits', 'Coordinación de una visita a la oficina']] as const).map(([key, label]) => <label key={key} className="flex gap-2"><input type="checkbox" checked={config[key]} onChange={e => setConfig({ ...config, [key]: e.target.checked })} />{label}</label>)}
      <p className="text-xs">Se usan únicamente temas relacionados con lo que pidió el lead y con la oferta disponible. Si no hay un siguiente paso útil, se omite el envío.</p>
    </fieldset>
    <p>Si el lead responde, se cancela el seguimiento pendiente y la conversación continúa según su respuesta. Aceptar información sobre financiamiento no autoriza una solicitud de crédito.</p>
    <p className="text-xs">Un mensaje de semana 1 por contacto y proyecto. Al menos siete días entre seguimientos, incluido el de 24 horas; si este se envió, la semana 1 puede desplazarse. Se respetan el permiso de seguimiento, el horario de atención y las pausas por asesor, visita o evaluación. La activación no escribe a conversaciones antiguas.</p>
    <details className="rounded-xl border border-[#deded4] p-4"><summary className="cursor-pointer font-semibold">Plantillas conectadas</summary><div className="mt-3 space-y-2">
      <p>Brochure: {WEEK_ONE_ROUTES.brochure.templateName} · Salesbot {WEEK_ONE_ROUTES.brochure.botId}</p>
      <p>Seguimiento: {WEEK_ONE_ROUTES.followup.templateName} · Salesbot {WEEK_ONE_ROUTES.followup.botId} · campo {WEEK_ONE_ROUTES.followup.fieldId}</p>
      <p>La variable contiene una frase corta, por ejemplo «conocer la distribución del departamento 202». La conexión usa el ID del campo, aunque cambie su nombre.</p>
    </div></details>
    <Button onClick={() => void save()} disabled={busy}>{busy ? 'Guardando…' : 'Guardar semana 1'}</Button>
    <div className="space-y-3 rounded-xl border border-[#deded4] bg-[#f7f7f2] p-4">
      <p className="font-semibold">Brochure entregado por un asesor</p><p>Si lo compartió por fuera del sistema, registre la entrega para evitar repetirlo. Los mensajes automáticos quedan registrados al ser aceptados por Kommo; eso no confirma su lectura.</p>
      <label className="block">ID del lead en Kommo<Input type="number" min="1" value={leadId} onChange={e => setLeadId(e.target.value)} /></label>
      <Button variant="outline" disabled={busy || !leadId} onClick={() => void mark()}>Registrar que ya compartí el brochure</Button>
    </div>
  </div>
}
