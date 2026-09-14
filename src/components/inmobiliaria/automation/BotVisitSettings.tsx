'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { visitInvitation, type BotVisitPolicy } from '@/lib/inmobiliaria/botVisits'
import { saveBotVisitsAction } from '@/app/inmobiliaria/automatizacion/actions'

export function BotVisitSettings({ projectId, initial, mode, updatedAt, onSaved }: { projectId: string; initial: BotVisitPolicy; mode: string; updatedAt: string; onSaved: () => Promise<void> }) {
  const [policy, setPolicy] = useState(initial), [saving, setSaving] = useState(false)
  const save = async () => {
    setSaving(true)
    try { await saveBotVisitsAction(projectId, policy, updatedAt); await onSaved(); toast.success('Configuración de visitas guardada.') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'No se pudo guardar.') }
    finally { setSaving(false) }
  }
  return <div className="space-y-5 text-sm text-[#3a3d36]">
    <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={policy.allowSuggestions} onChange={e => setPolicy({ ...policy, allowSuggestions: e.target.checked })} />Permitir que el bot sugiera una visita</label>
    <p>Al desactivarlo, el bot responde las consultas y comparte material sin invitar a una visita. Si el cliente pide una cita por iniciativa propia, puede ayudarle a coordinarla.</p>
    <label className="block">Destino de la visita durante Lanzamiento
      <select className="mt-2 block w-full rounded-lg border border-[#deded4] bg-white p-3" value={policy.launchDestination} onChange={e => setPolicy({ ...policy, launchDestination: e.target.value as BotVisitPolicy['launchDestination'] })}>
        <option value="site">Terreno donde se construirá el proyecto</option>
        <option value="office">Oficina de atención, en la misma dirección</option>
      </select>
    </label>
    <div className="rounded-xl bg-[#f7f7f2] border border-[#deded4] p-4"><p className="mb-2 font-semibold">Ejemplo de invitación</p><p>{visitInvitation(mode, { ...policy, allowSuggestions: true })}</p></div>
    <p>En Lanzamiento todavía no hay departamentos construidos. El bot presenta el brochure y los modelos como referencias del proyecto previsto.</p>
    <Button disabled={saving} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar configuración de visitas'}</Button>
  </div>
}
