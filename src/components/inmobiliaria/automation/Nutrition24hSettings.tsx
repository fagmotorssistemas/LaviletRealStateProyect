'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NUTRITION_24H_BODY, type Nutrition24hConfig } from '@/lib/inmobiliaria/nutrition24h'
import { saveNutrition24hAction } from '@/app/inmobiliaria/automatizacion/actions'

export function Nutrition24hSettings({ projectId, initial, updatedAt: initialUpdatedAt, onSaved }: { projectId: string; initial: Nutrition24hConfig; updatedAt: string; onSaved: (config: Nutrition24hConfig, updatedAt: string) => void }) {
  const [config, setConfig] = useState(initial)
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt)
  const [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try {
      const result = await saveNutrition24hAction(projectId, config, updatedAt)
      setConfig(result.config); setUpdatedAt(result.updatedAt)
      onSaved(result.config, result.updatedAt)
      toast.success(result.config.enabled ? 'Seguimiento activado para nuevas conversaciones elegibles.' : 'Configuración guardada. Seguimiento desactivado.')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5 text-sm text-[#3a3d36]">
    <p>Retoma el tema pendiente 24 horas después del último mensaje del cliente. Se envía de lunes a viernes de 09:00 a 18:00 y los sábados dentro del horario del proyecto, siempre respetando el horario de atención. Si coincide con la noche o el domingo, espera a la siguiente apertura.</p>
    <div className="rounded-xl border border-[#deded4] bg-[#f7f7f2] p-4 space-y-2">
      <p className="font-semibold">Texto para su plantilla de WhatsApp · categoría Marketing</p>
      <p>{NUTRITION_24H_BODY}</p>
      <p>Vincule {'{{1}}'} al campo de lead <strong>Nutricion_24h</strong>. El sistema completa solo el tema; la plantilla mantiene el resto del texto.</p>
      <p className="text-xs">Ejemplos del campo: «ayudarle con lo que necesite», «ampliar la información sobre la suite 210», «orientarle sobre las opciones de financiamiento».</p>
      <p className="text-xs">Una plantilla general que contiene únicamente [Nutricion_24h] no sustituye una plantilla de WhatsApp aprobada por Meta.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-3">
      <label>Nombre de plantilla<Input value={config.templateName} onChange={e => setConfig({ ...config, templateName: e.target.value, metaApproved: false, templateLinked: false, enabled: false })} /></label>
      <label>ID del Salesbot<Input type="number" min="1" value={config.botId} onChange={e => setConfig({ ...config, botId: Number(e.target.value), templateLinked: false, enabled: false })} /></label>
      <label>ID del campo Nutricion_24h<Input type="number" min="1" value={config.fieldId} onChange={e => setConfig({ ...config, fieldId: Number(e.target.value), templateLinked: false, enabled: false })} /></label>
    </div>
    <div className="space-y-3">
      <label className="flex gap-2"><input type="checkbox" checked={config.metaApproved} onChange={e => setConfig({ ...config, metaApproved: e.target.checked, enabled: false })} />La plantilla de WhatsApp con este texto aparece como Aprobada por Meta.</label>
      <label className="flex gap-2"><input type="checkbox" checked={config.templateLinked} onChange={e => setConfig({ ...config, templateLinked: e.target.checked, enabled: false })} />El Salesbot envía esa plantilla una sola vez, con la variable vinculada a Nutricion_24h, sin otro temporizador ni mensajes adicionales.</label>
      <label className="flex gap-2 font-semibold"><input type="checkbox" checked={config.enabled} disabled={!config.metaApproved || !config.templateLinked} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />Activar seguimiento de 24 horas</label>
    </div>
    <p className="text-xs">Solo se envía con permiso de seguimiento, IA activa y sin atención de un asesor, cita pendiente o consulta sin responder. Si el cliente contesta, se cancela el mensaje pendiente. Máximo un seguimiento de este tipo cada 7 días. Al activarlo se programan los nuevos turnos atendidos; no se escribe a conversaciones antiguas.</p>
    <Button onClick={() => void save()} disabled={saving}>{saving ? 'Guardando…' : 'Guardar seguimiento de 24 horas'}</Button>
  </div>
}
