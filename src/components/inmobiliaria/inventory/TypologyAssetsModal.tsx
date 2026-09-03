'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  deleteTypologyAssetAction,
  listTypologiesImportAction,
  listTypologyAssetsAction,
} from '@/app/inmobiliaria/inventario-2/actions'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { TYPOLOGY_ASSET_MAX_BYTES } from '@/lib/typology-assets'
import { cn } from '@/lib/utils'
import {
  TYPOLOGY_ASSET_KIND_OPTIONS,
  unitImportCategoryLabel,
  type TypologyAsset,
  type TypologyAssetKind,
  type TypologyImport,
} from '@/types/inmobiliaria'

type AssetRow = TypologyAsset & { public_url: string }

type FileJob = {
  id: string
  name: string
  status: 'pending' | 'uploading' | 'done' | 'duplicate' | 'error'
  message?: string
}

type Notice = {
  tone: 'info' | 'ok' | 'warn' | 'error'
  text: string
}

type TypologyAssetsModalProps = {
  isOpen: boolean
  onClose: () => void
}

const MAX_MB = TYPOLOGY_ASSET_MAX_BYTES / (1024 * 1024)

export function TypologyAssetsModal({ isOpen, onClose }: TypologyAssetsModalProps) {
  const [typologies, setTypologies] = useState<TypologyImport[]>([])
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<TypologyAssetKind>('plano')
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [jobs, setJobs] = useState<FileJob[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTypologies = useCallback(async () => {
    try {
      const rows = await listTypologiesImportAction()
      setTypologies(rows)
      setCode((prev) => prev || rows[0]?.code || '')
    } catch {
      toast.error('No se pudieron cargar las tipologías')
    }
  }, [])

  const loadAssets = useCallback(async (typologyCode: string) => {
    if (!typologyCode) {
      setAssets([])
      return
    }
    setLoadingList(true)
    try {
      setAssets(await listTypologyAssetsAction(typologyCode))
    } catch {
      toast.error('No se pudieron cargar las imágenes')
    } finally {
      setLoadingList(false)
    }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadTypologies()
  }, [isOpen, loadTypologies])

  useEffect(() => {
    if (!isOpen || !code) return
    void loadAssets(code)
  }, [isOpen, code, loadAssets])

  const uploadOne = async (file: File): Promise<FileJob['status']> => {
    const body = new FormData()
    body.set('typology_code', code)
    body.set('kind', kind)
    body.set('file', file)

    const res = await fetch('/api/typology-assets/upload', {
      method: 'POST',
      body,
      credentials: 'same-origin',
    })
    const raw = await res.text()
    let payload: { error?: string; code?: string } = {}
    try {
      payload = raw ? (JSON.parse(raw) as { error?: string; code?: string }) : {}
    } catch {
      throw new Error(raw.slice(0, 180) || `El servidor respondió ${res.status}`)
    }

    if (res.status === 409 || payload.code === 'duplicate') return 'duplicate'
    if (!res.ok) throw new Error(payload.error || `Error al subir (${res.status})`)
    return 'done'
  }

  const onFiles = async (list: FileList | File[] | null) => {
    if (!code) {
      setNotice({ tone: 'error', text: 'Selecciona una tipología primero.' })
      toast.error('Selecciona una tipología primero')
      return
    }
    const files = list ? Array.from(list) : []
    if (files.length === 0) {
      setNotice({ tone: 'warn', text: 'No llegó ningún archivo. Prueba otra vez con “Elegir archivo”.' })
      return
    }
    const images = files.filter(
      (file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name),
    )
    if (images.length === 0) {
      const names = files.map((f) => `${f.name} (${f.type || 'sin tipo'})`).join(', ')
      setNotice({
        tone: 'error',
        text: `El archivo no se reconoció como imagen: ${names}`,
      })
      toast.error('El archivo no es una imagen')
      return
    }
    const pngs = images
    setNotice({
      tone: 'info',
      text: `Recibí ${pngs.length} archivo(s): ${pngs.map((f) => f.name).join(', ')}. Subiendo a ${code} / ${kind}…`,
    })
    const nextJobs: FileJob[] = pngs.map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      name: file.name,
      status: 'pending',
    }))
    setJobs(nextJobs)
    setUploading(true)
    toast.message(`Subiendo ${pngs.length} archivo(s)…`)

    let ok = 0
    let dup = 0
    let fail = 0

    for (let i = 0; i < pngs.length; i++) {
      const file = pngs[i]
      setJobs((prev) => prev.map((job, idx) => (idx === i ? { ...job, status: 'uploading' } : job)))
      try {
        if (file.size > TYPOLOGY_ASSET_MAX_BYTES) {
          fail += 1
          setJobs((prev) =>
            prev.map((job, idx) =>
              idx === i
                ? { ...job, status: 'error', message: `Supera ${MAX_MB} MB` }
                : job,
            ),
          )
          continue
        }
        const status = await uploadOne(file)
        if (status === 'done') ok += 1
        else dup += 1
        setJobs((prev) =>
          prev.map((job, idx) =>
            idx === i
              ? {
                  ...job,
                  status,
                  message: status === 'duplicate' ? 'Ya existe para esta tipología y tipo' : undefined,
                }
              : job,
          ),
        )
      } catch (err) {
        fail += 1
        const message = err instanceof Error ? err.message : 'Error al subir'
        toast.error(message)
        setJobs((prev) =>
          prev.map((job, idx) =>
            idx === i ? { ...job, status: 'error', message } : job,
          ),
        )
      }
    }

    setUploading(false)
    await loadAssets(code)
    if (ok) toast.success(`${ok} imagen(es) guardadas`)
    if (dup) toast.error(`${dup} ya existían para esa tipología`)
    if (fail) toast.error(`${fail} no se pudieron guardar`)
    if (ok && !fail && !dup) {
      setNotice({ tone: 'ok', text: `Guardado. ${ok} imagen(es) en ${code} (${kind}).` })
    } else {
      setNotice({
        tone: fail ? 'error' : 'warn',
        text: `Resultado: ${ok} guardada(s), ${dup} duplicada(s), ${fail} con error. Revisa la lista de abajo.`,
      })
    }
  }

  const onDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await deleteTypologyAssetAction(id)
      toast.success('Imagen eliminada')
      await loadAssets(code)
    } catch {
      toast.error('No se pudo borrar la imagen y el archivo')
    } finally {
      setDeletingId(null)
    }
  }

  const typologyOptions = typologies.map((row) => ({
    value: row.code,
    label: `${row.code} · ${row.name} (${unitImportCategoryLabel(row.category)})`,
  }))

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Imágenes por tipología" size="xl">
      <div className="space-y-5">
        <div
          className={cn(
            'rounded-lg border px-3 py-2.5 text-sm',
            notice?.tone === 'ok' && 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
            notice?.tone === 'error' && 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
            notice?.tone === 'warn' && 'border-[#BDA27E]/50 bg-[#f7f3ee] text-[#7a6240]',
            (!notice || notice.tone === 'info') && 'border-[#2B1A18]/10 bg-[#f7f3ee] text-[#555850]',
          )}
        >
          {notice?.text ?? 'Aún no hay subida. Elige un archivo y aquí verás si se guardó o el error.'}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Tipología"
            options={typologyOptions}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Select
            label="Tipo"
            options={TYPOLOGY_ASSET_KIND_OPTIONS}
            value={kind}
            onChange={(e) => setKind(e.target.value as TypologyAssetKind)}
          />
        </div>

        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm',
            dragging
              ? 'border-[#787D62] bg-[#787D62]/10 text-[#3a3d36]'
              : 'border-[#787D62]/30 bg-[#f7f3ee] text-[#555850]',
          )}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragging(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void onFiles(Array.from(e.dataTransfer.files))
          }}
        >
          <ImagePlus size={20} className="text-[#787D62]" />
          <span className="font-medium">Planos o renders (varios a la vez)</span>
          <span className="text-xs text-[#8a8d87]">PNG, JPG o WebP · máx. {MAX_MB} MB · se guarda como WebP lossless</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            disabled={!code || uploading}
            className="mt-1 w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#787D62] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void onFiles(files)
            }}
          />
        </div>

        {jobs.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {jobs.map((job) => (
              <li
                key={job.id}
                className="flex items-center justify-between gap-3 rounded-md border border-[#2B1A18]/8 bg-white px-3 py-2"
              >
                <span className="min-w-0 truncate">{job.name}</span>
                <span
                  className={cn(
                    'shrink-0 text-xs font-semibold tracking-wide uppercase',
                    job.status === 'done' && 'text-[#787D62]',
                    job.status === 'duplicate' && 'text-[#9a7d55]',
                    job.status === 'error' && 'text-[#8a5c58]',
                    (job.status === 'pending' || job.status === 'uploading') && 'text-[#8a8d87]',
                  )}
                >
                  {job.status === 'pending' && 'En cola'}
                  {job.status === 'uploading' && 'Subiendo…'}
                  {job.status === 'done' && 'Listo'}
                  {job.status === 'duplicate' && (job.message ?? 'Duplicado')}
                  {job.status === 'error' && (job.message ?? 'Error')}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <p className="crm-field-label mb-2">Cargadas en {code || '—'}</p>
          {loadingList ? (
            <p className="text-sm text-[#8a8d87]">Cargando imágenes…</p>
          ) : assets.length === 0 ? (
            <p className="text-sm text-[#8a8d87]">Aún no hay imágenes para esta tipología.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((asset) => (
                <li key={asset.id} className="overflow-hidden rounded-lg border border-[#2B1A18]/8 bg-white">
                  <div className="relative aspect-[4/3] bg-[#f4f4ef]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.public_url}
                      alt={asset.file_name}
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div className="flex items-start justify-between gap-2 p-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-[#3a3d36]">{asset.file_name}</p>
                      <p className="text-[10px] tracking-wide text-[#8a8d87] uppercase">{asset.kind}</p>
                    </div>
                    <button
                      type="button"
                      className="rounded p-1 text-[#8a8d87] hover:bg-[#f3eaea] hover:text-[#8a5c58]"
                      disabled={deletingId === asset.id}
                      onClick={() => void onDelete(asset.id)}
                      aria-label={`Borrar ${asset.file_name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </Modal>
  )
}
