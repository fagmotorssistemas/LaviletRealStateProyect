'use client'

import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { ContractStatus, Lead, Project, Unit } from '@/types/inmobiliaria'
import { useAuth } from '@/contexts/AuthContext'
import { getDataAccessScope } from '@/lib/inmobiliaria/dataScope'
import {
  CONTRACTS_FILES_BUCKET,
  createContract,
  listLeads,
  listProjects,
  updateContractFiles,
} from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'

const statusOptions = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'firmado', label: 'Firmado' },
  { value: 'anulado', label: 'Anulado' },
]

interface CreateContractModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
  tenantId: string
}

export function CreateContractModal({ isOpen, onClose, onCreated, tenantId }: CreateContractModalProps) {
  const { supabase, user, profile } = useAuth()
  const scope = useMemo(() => getDataAccessScope(user?.id, profile?.role), [user?.id, profile?.role])
  const [loading, setLoading] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [contractPdfFile, setContractPdfFile] = useState<File | null>(null)
  const [anticipoProofFile, setAnticipoProofFile] = useState<File | null>(null)
  const [fileResetToken, setFileResetToken] = useState(0)
  const [form, setForm] = useState({
    lead_id: '',
    project_id: '',
    contract_number: '',
    status: 'pendiente' as ContractStatus,
    anticipo_amount: '',
    anticipo_date: '',
  })

  useEffect(() => {
    if (isOpen && tenantId) {
      Promise.all([listLeads(supabase, { tenantId, scope }), listProjects(supabase, tenantId)])
        .then(([lRes, p]) => {
          setLeads(lRes.data)
          setProjects(p)
        })
        .catch(console.error)
    }
  }, [isOpen, tenantId, supabase, scope])

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const anticipoProvided = Boolean(form.anticipo_amount?.trim() || form.anticipo_date)
    const missing: string[] = []
    if (!form.lead_id) missing.push('Lead')
    if (!form.contract_number?.trim()) missing.push('Número de contrato')
    if (!form.project_id) missing.push('Proyecto')
    if (selectedUnits.length < 1) missing.push('Al menos una unidad vinculada al contrato')
    if (!contractPdfFile) missing.push('PDF del contrato')
    if (anticipoProvided && !anticipoProofFile) missing.push('Comprobante del anticipo')

    if (missing.length > 0) {
      toast.error(`Faltan datos obligatorios: ${missing.join(', ')}.`)
      return
    }

    setLoading(true)
    try {
      const safeFileName = (name: string) =>
        name
          .trim()
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .slice(0, 120)

      const contract = await createContract(
        supabase,
        {
          tenant_id: tenantId,
          lead_id: form.lead_id,
          contract_number: form.contract_number.trim(),
          status: form.status,
          anticipo_amount: form.anticipo_amount ? Number(form.anticipo_amount) : null,
          anticipo_date: form.anticipo_date || null,
          created_by: user?.id ?? null,
        },
        selectedUnits.map((u) => u.id),
      )

      const basePath = `${tenantId}/contracts/${contract.id}`

      let pdfUrl: string | null = null
      let anticipoProofUrl: string | null = null

      const contractPdfPath = `${basePath}/contrato.pdf`
      const { error: pdfUploadError } = await supabase.storage
        .from(CONTRACTS_FILES_BUCKET)
        .upload(contractPdfPath, contractPdfFile!, {
          contentType: contractPdfFile!.type || 'application/pdf',
          upsert: true,
        })
      if (pdfUploadError) throw pdfUploadError

      const { data: contractPublicUrl } = supabase.storage.from(CONTRACTS_FILES_BUCKET).getPublicUrl(contractPdfPath)
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

        const { data: anticipoPublicUrl } = supabase.storage.from(CONTRACTS_FILES_BUCKET).getPublicUrl(anticipoFilePath)
        anticipoProofUrl = anticipoPublicUrl.publicUrl
      }

      await updateContractFiles(supabase, contract.id, {
        pdf_url: pdfUrl,
        anticipo_proof_url: anticipoProofUrl,
      })

      toast.success('Contrato creado')
      onCreated()
      onClose()
      setForm({
        lead_id: '',
        project_id: '',
        contract_number: '',
        status: 'pendiente',
        anticipo_amount: '',
        anticipo_date: '',
      })
      setSelectedUnits([])
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
          <Select
            id="lead"
            label="Lead *"
            options={leads.map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Seleccionar lead"
            value={form.lead_id}
            required
            onChange={(e) => update('lead_id', e.target.value)}
          />
          <Input
            id="contract_number"
            label="Nro. Contrato *"
            placeholder="LV-2026-005"
            value={form.contract_number}
            required
            onChange={(e) => update('contract_number', e.target.value)}
          />
        </div>

        <Select
          id="project"
          label="Proyecto *"
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Seleccionar proyecto"
          value={form.project_id}
          required
          onChange={(e) => {
            update('project_id', e.target.value)
            setSelectedUnits([])
          }}
        />

        <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
          <AppointmentInterestUnitsPicker
            tenantId={tenantId}
            projectId={form.project_id}
            selectedUnits={selectedUnits}
            onChange={setSelectedUnits}
            sectionLabel="Unidades del contrato *"
            helperText="Busca por número de unidad. Debes vincular al menos una unidad (se guarda en contract_units)."
            emptyProjectMessage="Selecciona un proyecto para buscar y añadir unidades al contrato."
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Select id="status" label="Estado *" options={statusOptions} value={form.status} onChange={(e) => update('status', e.target.value)} />
          <Input
            id="anticipo"
            label="Monto anticipo"
            type="number"
            step="0.01"
            placeholder="50000"
            value={form.anticipo_amount}
            onChange={(e) => update('anticipo_amount', e.target.value)}
          />
          <Input id="anticipo_date" label="Fecha anticipo" type="date" value={form.anticipo_date} onChange={(e) => update('anticipo_date', e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Input
              key={`contract-pdf-${fileResetToken}`}
              id="contract_pdf"
              label="Contrato (PDF) *"
              type="file"
              accept="application/pdf"
              onChange={(e) => setContractPdfFile(e.target.files?.[0] ?? null)}
            />
            {contractPdfFile && <p className="text-xs text-gray-500 mt-1 truncate">{contractPdfFile.name}</p>}
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
            {anticipoProofFile && <p className="text-xs text-gray-500 mt-1 truncate">{anticipoProofFile.name}</p>}
          </div>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Si indicas monto o fecha de anticipo, debes adjuntar el comprobante.
        </p>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? 'Creando...' : 'Crear Contrato'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

