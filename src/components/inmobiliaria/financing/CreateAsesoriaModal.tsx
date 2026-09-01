'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/AuthContext'
import { createAsesoriaFinanciamientoAction } from '@/app/inmobiliaria/financiamiento/actions'
import { listLeads } from '@/services/inmobiliaria.service'
import type { Lead } from '@/types/inmobiliaria'
import { toast } from 'sonner'

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

export function CreateAsesoriaModal({ isOpen, onClose, onCreated, tenantId }: Props) {
  const { supabase } = useAuth()
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadId, setLeadId] = useState('')
  const [mensaje, setMensaje] = useState('')

  useEffect(() => {
    if (!isOpen || !tenantId) return
    listLeads(supabase, { tenantId, page: 1, pageSize: 200 })
      .then((res) => setLeads(res.data))
      .catch(console.error)
  }, [isOpen, tenantId, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!leadId) {
      toast.error('Selecciona un lead')
      return
    }
    setLoading(true)
    try {
      await createAsesoriaFinanciamientoAction({
        tenant_id: tenantId,
        lead_id: leadId,
        mensaje_completo: mensaje.trim() || null,
      })
      toast.success('Solicitud de asesoría creada')
      onCreated()
      onClose()
      setLeadId('')
      setMensaje('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo crear la solicitud')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nueva solicitud de asesoría" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          id="asesoria-lead"
          label="Lead *"
          options={leads.map((l) => ({ value: l.id, label: l.name }))}
          placeholder="Seleccionar lead"
          value={leadId}
          onChange={(e) => setLeadId(e.target.value)}
        />
        <Textarea
          id="asesoria-msg"
          label="Mensaje del cliente"
          placeholder="Lo que pidió: banco, BIESS, entrada, plazo..."
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
        <p className="text-xs text-gray-500">
          Se guarda en <code>asesoria_financiamiento</code>. El estado inicia como no atendido.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear solicitud'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
