'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { ContractStatus, Lead, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import {
  CONTRACTS_FILES_BUCKET,
  createContract,
  listLeads,
  listUnits,
  updateContractFiles,
} from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { X } from 'lucide-react'

const statusOptions = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'firmado', label: 'Firmado' },
]

interface CreateContractModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

export function CreateContractModal({ isOpen, onClose, onCreated, tenantId }: CreateContractModalProps) {
  const { supabase, user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [contractPdfFile, setContractPdfFile] = useState<File | null>(null)
  const [anticipoProofFile, setAnticipoProofFile] = useState<File | null>(null)
  const [fileResetToken, setFileResetToken] = useState(0)
  const [form, setForm] = useState({
    lead_id: '', contract_number: '', status: 'pendiente', anticipo_amount: '', anticipo_date: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      Promise.all([
        listLeads(supabase, { tenantId }),
        listUnits(supabase, { tenantId }),
      ]).then(([lRes, uRes]) => { setLeads(lRes.data); setUnits(uRes.data) }).catch(console.error)
    }
  }, [isOpen, tenantId, supabase])

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))
  const toggleUnit = (id: string) => setSelectedUnitIds((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const anticipoProvided = Boolean(form.anticipo_amount || form.anticipo_date)
      if (!contractPdfFile) {
        toast.error('Adjunta el contrato en PDF')
        return
      }
      if (anticipoProvided && !anticipoProofFile) {
        toast.error('Adjunta el comprobante del anticipo')
        return
      }

      const safeFileName = (name: string) =>
        name
          .trim()
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 120)

      const contract = await createContract(supabase, {
        tenant_id: tenantId,
        lead_id: form.lead_id || null,
        contract_number: form.contract_number || null,
        status: form.status as ContractStatus,
        anticipo_amount: form.anticipo_amount ? Number(form.anticipo_amount) : null,
        anticipo_date: form.anticipo_date || null,
        created_by: user?.id ?? null,
      }, selectedUnitIds.length ? selectedUnitIds : undefined)

      const basePath = `${tenantId}/contracts/${contract.id}`

      let pdfUrl: string | null = null
      let anticipoProofUrl: string | null = null

      const contractPdfPath = `${basePath}/contrato.pdf`
      const { error: pdfUploadError } = await supabase.storage
        .from(CONTRACTS_FILES_BUCKET)
        .upload(contractPdfPath, contractPdfFile, {
          contentType: contractPdfFile.type || 'application/pdf',
          upsert: true,
        })
      if (pdfUploadError) throw pdfUploadError

      const { data: contractPublicUrl } = supabase.storage
        .from(CONTRACTS_FILES_BUCKET)
        .getPublicUrl(contractPdfPath)
      pdfUrl = contractPublicUrl.publicUrl

      if (anticipoProvided && anticipoProofFile) {
        const anticipoFilePath = `${basePath}/anticipo/${safeFileName(anticipoProofFile.name)}`
        const { error: anticipoUploadError } = await supabase.storage
          .from(CONTRACTS_FILES_BUCKET)
          .upload(anticipoFilePath, anticipoProofFile, {
            contentType: anticipoProofFile.type || 'application/octet-stream',
            upsert: true,
          })
        if (anticipoUploadError) throw anticipoUploadError

        const { data: anticipoPublicUrl } = supabase.storage
          .from(CONTRACTS_FILES_BUCKET)
          .getPublicUrl(anticipoFilePath)
        anticipoProofUrl = anticipoPublicUrl.publicUrl
      }

      await updateContractFiles(supabase, contract.id, {
        pdf_url: pdfUrl,
        anticipo_proof_url: anticipoProofUrl,
      })

      toast.success('Contrato creado')
      onCreated()
      onClose()
      setForm({ lead_id: '', contract_number: '', status: 'pendiente', anticipo_amount: '', anticipo_date: '' })
      setSelectedUnitIds([])
      setContractPdfFile(null)
      setAnticipoProofFile(null)
      setFileResetToken((x) => x + 1)
    } catch {
      toast.error('Error al crear contrato')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Nuevo Contrato" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select id="lead" label="Lead" options={leads.map((l) => ({ value: l.id, label: l.name }))} placeholder="Seleccionar lead" value={form.lead_id} onChange={(e) => update('lead_id', e.target.value)} />
          <Input id="contract_number" label="Nro. Contrato" placeholder="LV-2026-005" value={form.contract_number} onChange={(e) => update('contract_number', e.target.value)} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select id="status" label="Estado" options={statusOptions} value={form.status} onChange={(e) => update('status', e.target.value)} />
          <Input id="anticipo" label="Monto anticipo" type="number" step="0.01" placeholder="50000" value={form.anticipo_amount} onChange={(e) => update('anticipo_amount', e.target.value)} />
          <Input id="anticipo_date" label="Fecha anticipo" type="date" value={form.anticipo_date} onChange={(e) => update('anticipo_date', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              key={`contract-pdf-${fileResetToken}`}
              id="contract_pdf"
              label="Contrato (PDF)"
              type="file"
              accept="application/pdf"
              onChange={(e) => setContractPdfFile(e.target.files?.[0] ?? null)}
            />
            {contractPdfFile && (
              <p className="text-xs text-gray-500 mt-1 truncate">{contractPdfFile.name}</p>
            )}
          </div>
          <div>
            <Input
              key={`anticipo-proof-${fileResetToken}`}
              id="anticipo_proof"
              label="Comprobante anticipo"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setAnticipoProofFile(e.target.files?.[0] ?? null)}
            />
            {anticipoProofFile && (
              <p className="text-xs text-gray-500 mt-1 truncate">{anticipoProofFile.name}</p>
            )}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700 block mb-2">Unidades del contrato</label>
          {selectedUnitIds.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedUnitIds.map((id) => {
                const u = units.find((x) => x.id === id)
                return (<span key={id} className="inline-flex items-center gap-1 rounded-lg bg-[#BDA27E]/15 px-2.5 py-1 text-xs font-medium text-[#2B1A18]">{u?.unit_number}<button type="button" onClick={() => toggleUnit(id)} className="hover:text-red-600 cursor-pointer"><X size={12} /></button></span>)
              })}
            </div>
          )}
          <div className="max-h-36 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
            {units.map((u) => (
              <label key={u.id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm">
                <input type="checkbox" checked={selectedUnitIds.includes(u.id)} onChange={() => toggleUnit(u.id)} className="rounded border-gray-300 h-4 w-4" />
                <span className="font-medium">{u.unit_number}</span>
                <span className="text-gray-500">{u.category}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={loading}>{loading ? 'Creando...' : 'Crear Contrato'}</Button>
        </div>
      </form>
    </Modal>
  )
}
