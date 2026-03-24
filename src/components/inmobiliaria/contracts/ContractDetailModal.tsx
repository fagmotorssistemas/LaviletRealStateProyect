'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'
import { PriceText } from '@/components/inmobiliaria/shared/PriceText'
import type { Contract, ContractStatus, ContractWithUnits, Lead, Project, Unit } from '@/types/inmobiliaria'
import { formatDate } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import {
  CONTRACTS_FILES_BUCKET,
  getContract,
  listLeads,
  listProjects,
  updateContract,
} from '@/services/inmobiliaria.service'
import { toast } from 'sonner'
import { Building2, ExternalLink, FileText, Pencil, Receipt, User } from 'lucide-react'
import { AppointmentInterestUnitsPicker } from '@/components/inmobiliaria/agenda/AppointmentInterestUnitsPicker'

const statusOptions = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'firmado', label: 'Firmado' },
  { value: 'anulado', label: 'Anulado' },
]

const defaultForm = {
  lead_id: '',
  project_id: '',
  contract_number: '',
  status: 'pendiente' as ContractStatus,
  anticipo_amount: '',
  anticipo_date: '',
}

function contractToForm(c: ContractWithUnits) {
  return {
    lead_id: c.lead_id ?? '',
    project_id: c.units[0]?.project_id ?? '',
    contract_number: c.contract_number ?? '',
    status: c.status,
    anticipo_amount: c.anticipo_amount != null ? String(c.anticipo_amount) : '',
    anticipo_date: c.anticipo_date ? c.anticipo_date.slice(0, 10) : '',
  }
}

interface ContractDetailModalProps {
  contract: Contract | null
  isOpen: boolean
  onClose: () => void
  tenantId: string
  onContractUpdated?: () => void
}

export function ContractDetailModal({
  contract,
  isOpen,
  onClose,
  tenantId,
  onContractUpdated,
}: ContractDetailModalProps) {
  const { supabase } = useAuth()
  const [detail, setDetail] = useState<ContractWithUnits | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [form, setForm] = useState(defaultForm)
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([])
  const [newContractPdf, setNewContractPdf] = useState<File | null>(null)
  const [newAnticipoProof, setNewAnticipoProof] = useState<File | null>(null)
  const [fileResetToken, setFileResetToken] = useState(0)

  useEffect(() => {
    if (!isOpen) {
      setIsEditing(false)
      setDetail(null)
      setLoadError(false)
      setNewContractPdf(null)
      setNewAnticipoProof(null)
      return
    }
    if (!contract?.id) return

    let cancelled = false
    setLoadingDetail(true)
    setLoadError(false)
    getContract(supabase, contract.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true)
          toast.error('No se pudo cargar el contrato')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, contract?.id, supabase])

  useEffect(() => {
    if (!isOpen || !tenantId) return
    Promise.all([listProjects(supabase, tenantId), listLeads(supabase, { tenantId })])
      .then(([p, lRes]) => {
        setProjects(p)
        setLeads(lRes.data)
      })
      .catch(console.error)
  }, [isOpen, tenantId, supabase])

  const updateField = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }))

  const startEdit = () => {
    if (!detail) return
    setForm(contractToForm(detail))
    setSelectedUnits([...detail.units])
    setNewContractPdf(null)
    setNewAnticipoProof(null)
    setFileResetToken((x) => x + 1)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    if (!detail) return
    setForm(contractToForm(detail))
    setSelectedUnits([...detail.units])
    setNewContractPdf(null)
    setNewAnticipoProof(null)
    setFileResetToken((x) => x + 1)
    setIsEditing(false)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!detail) return

    const anticipoProvided = Boolean(form.anticipo_amount?.trim() || form.anticipo_date)
    const missing: string[] = []
    if (!form.lead_id) missing.push('Lead')
    if (!form.contract_number?.trim()) missing.push('Número de contrato')
    if (!form.project_id) missing.push('Proyecto')
    if (selectedUnits.length < 1) missing.push('Al menos una unidad vinculada al contrato')
    if (!newContractPdf && !detail.pdf_url) missing.push('PDF del contrato')
    if (anticipoProvided && !newAnticipoProof && !detail.anticipo_proof_url) {
      missing.push('Comprobante del anticipo')
    }

    if (missing.length > 0) {
      toast.error(`Faltan datos obligatorios: ${missing.join(', ')}.`)
      return
    }

    const safeFileName = (name: string) =>
      name
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 120)

    setSaving(true)
    try {
      const basePath = `${tenantId}/contracts/${detail.id}`
      let pdfUrl = detail.pdf_url
      let anticipoProofUrl = detail.anticipo_proof_url

      if (newContractPdf) {
        const contractPdfPath = `${basePath}/contrato.pdf`
        const { error: pdfUploadError } = await supabase.storage
          .from(CONTRACTS_FILES_BUCKET)
          .upload(contractPdfPath, newContractPdf, {
            contentType: newContractPdf.type || 'application/pdf',
            upsert: true,
          })
        if (pdfUploadError) throw pdfUploadError
        const { data: u } = supabase.storage.from(CONTRACTS_FILES_BUCKET).getPublicUrl(contractPdfPath)
        pdfUrl = u.publicUrl
      }

      if (anticipoProvided && newAnticipoProof) {
        const anticipoFilePath = `${basePath}/anticipo/${safeFileName(newAnticipoProof.name)}`
        const { error: anticipoUploadError } = await supabase.storage
          .from(CONTRACTS_FILES_BUCKET)
          .upload(anticipoFilePath, newAnticipoProof, {
            contentType: newAnticipoProof.type || 'application/octet-stream',
            upsert: true,
          })
        if (anticipoUploadError) throw anticipoUploadError
        const { data: u } = supabase.storage.from(CONTRACTS_FILES_BUCKET).getPublicUrl(anticipoFilePath)
        anticipoProofUrl = u.publicUrl
      }

      await updateContract(
        supabase,
        detail.id,
        {
          lead_id: form.lead_id,
          contract_number: form.contract_number.trim(),
          status: form.status,
          anticipo_amount: form.anticipo_amount ? Number(form.anticipo_amount) : null,
          anticipo_date: form.anticipo_date || null,
          pdf_url: pdfUrl,
          anticipo_proof_url: anticipoProofUrl,
        },
        selectedUnits.map((u) => u.id),
      )

      const fresh = await getContract(supabase, detail.id)
      setDetail(fresh)
      onContractUpdated?.()
      toast.success('Contrato actualizado')
      setIsEditing(false)
      setNewContractPdf(null)
      setNewAnticipoProof(null)
      setFileResetToken((x) => x + 1)
    } catch {
      toast.error('Error al guardar los cambios')
    } finally {
      setSaving(false)
    }
  }

  const retryLoad = () => {
    if (!contract?.id) return
    setLoadingDetail(true)
    setLoadError(false)
    getContract(supabase, contract.id)
      .then(setDetail)
      .catch(() => {
        setLoadError(true)
        toast.error('No se pudo cargar el contrato')
      })
      .finally(() => setLoadingDetail(false))
  }

  if (!contract) return null

  const titleLabel = detail?.contract_number || contract.contract_number || 'Contrato'
  const modalTitle = isEditing ? `Editar — ${titleLabel}` : `Contrato — ${titleLabel}`

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="lg"
      headerActions={
        detail && !isEditing && !loadingDetail && !loadError ? (
          <button
            type="button"
            onClick={startEdit}
            title="Editar"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#2B1A18] transition-colors cursor-pointer"
          >
            <Pencil size={18} aria-hidden />
            <span className="sr-only">Editar</span>
          </button>
        ) : null
      }
    >
      {loadingDetail && (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loadingDetail && loadError && (
        <div className="text-center py-10 space-y-4">
          <p className="text-sm text-gray-600">No se pudo cargar la información.</p>
          <Button type="button" variant="outline" onClick={retryLoad}>
            Reintentar
          </Button>
        </div>
      )}

      {!loadingDetail && !loadError && detail && !isEditing && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={detail.status} type="contract" />
            {detail.lead && (
              <span className="text-sm text-gray-600 flex items-center gap-1.5">
                <User size={14} className="text-gray-400" />
                {detail.lead.name}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-400">Número</p>
              <p className="font-medium text-gray-900">{detail.contract_number ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Anticipo</p>
              <PriceText value={detail.anticipo_amount} size="sm" />
            </div>
            <div>
              <p className="text-xs text-gray-400">Fecha anticipo</p>
              <p className="text-gray-800">{detail.anticipo_date ? formatDate(detail.anticipo_date) : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Registro</p>
              <p className="text-gray-800">{formatDate(detail.created_at)}</p>
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Unidades del contrato</h4>
            {detail.units.length > 0 ? (
              <div className="space-y-2">
                {detail.units.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
                    <span className="font-medium text-gray-900">{unit.unit_number}</span>
                    <span className="text-gray-500">{unit.category}</span>
                    <StatusBadge status={unit.status} type="unit" className="ml-auto shrink-0" />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 italic">Sin unidades vinculadas.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            {detail.pdf_url && (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => window.open(detail.pdf_url ?? undefined, '_blank', 'noopener,noreferrer')}
              >
                <FileText size={16} />
                Ver contrato (PDF)
                <ExternalLink size={14} className="opacity-60" />
              </Button>
            )}
            {detail.anticipo_proof_url && (
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => window.open(detail.anticipo_proof_url ?? undefined, '_blank', 'noopener,noreferrer')}
              >
                <Receipt size={16} />
                Ver comprobante
                <ExternalLink size={14} className="opacity-60" />
              </Button>
            )}
          </div>
        </div>
      )}

      {!loadingDetail && !loadError && detail && isEditing && (
        <form onSubmit={handleSaveEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Select
              id="edit-lead"
              label="Lead *"
              options={leads.map((l) => ({ value: l.id, label: l.name }))}
              placeholder="Seleccionar lead"
              value={form.lead_id}
              required
              onChange={(e) => updateField('lead_id', e.target.value)}
            />
            <Input
              id="edit-number"
              label="Nro. Contrato *"
              value={form.contract_number}
              required
              onChange={(e) => updateField('contract_number', e.target.value)}
            />
          </div>

          <Select
            id="edit-project"
            label="Proyecto *"
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            placeholder="Seleccionar proyecto"
            value={form.project_id}
            required
            onChange={(e) => {
              updateField('project_id', e.target.value)
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
              helperText="Busca por número. Vincula al menos una unidad al contrato."
              emptyProjectMessage="Selecciona un proyecto para buscar unidades."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Select
              id="edit-status"
              label="Estado *"
              options={statusOptions}
              value={form.status}
              onChange={(e) => updateField('status', e.target.value)}
            />
            <Input
              id="edit-anticipo"
              label="Monto anticipo"
              type="number"
              step="0.01"
              value={form.anticipo_amount}
              onChange={(e) => updateField('anticipo_amount', e.target.value)}
            />
            <Input
              id="edit-anticipo-date"
              label="Fecha anticipo"
              type="date"
              value={form.anticipo_date}
              onChange={(e) => updateField('anticipo_date', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Input
                key={`edit-pdf-${fileResetToken}`}
                id="edit_pdf"
                label="Reemplazar PDF del contrato"
                type="file"
                accept="application/pdf"
                onChange={(e) => setNewContractPdf(e.target.files?.[0] ?? null)}
              />
              {newContractPdf && <p className="text-xs text-gray-500 mt-1 truncate">{newContractPdf.name}</p>}
              {!newContractPdf && detail.pdf_url && (
                <p className="text-xs text-gray-400 mt-1">Hay un PDF actual; súbelo solo si quieres reemplazarlo.</p>
              )}
            </div>
            <div>
              <Input
                key={`edit-anticipo-${fileResetToken}`}
                id="edit_anticipo_proof"
                label="Reemplazar comprobante anticipo"
                type="file"
                accept="application/pdf,image/*"
                onChange={(e) => setNewAnticipoProof(e.target.files?.[0] ?? null)}
              />
              {newAnticipoProof && <p className="text-xs text-gray-500 mt-1 truncate">{newAnticipoProof.name}</p>}
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={cancelEdit} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
