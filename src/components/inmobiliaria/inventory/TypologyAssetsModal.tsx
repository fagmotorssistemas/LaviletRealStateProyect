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
import { TYPOLOGY_ASSET_MAX_BYTES, TYPOLOGY_PANO_MAX_BYTES } from '@/lib/typology-assets'
import {
  assetMatchesRoom,
  isTourPanoramaFileName,
  TOUR_PANO_SLUG,
  vistaRoomSlug,
  type TourRoomDef,
} from '@/lib/tour/tourRooms'
import {
  fileMatchesScene,
  findLegacyRoomAsset,
  isLegacySceneFile,
  parseRoomSceneFileName,
  sceneCombos,
} from '@/lib/tour/roomScene'
import type { TourLightMode } from '@/types/tour'
import { cn } from '@/lib/utils'
import {
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

type SceneSlot = {
  room: string
  finish: string | null
  light: TourLightMode
  label: string
}

type TypologyAssetsModalProps = {
  isOpen: boolean
  onClose: () => void
}

const MAX_MB = TYPOLOGY_ASSET_MAX_BYTES / (1024 * 1024)
const PANO_MAX_MB = TYPOLOGY_PANO_MAX_BYTES / (1024 * 1024)
const DEFAULT_FINISHES = [
  { slug: 'acabado-1', name: 'Acabado 1' },
  { slug: 'acabado-2', name: 'Acabado 2' },
] as const

function labeledFinishes(rows: { slug: string; name: string }[]) {
  const source = rows.length > 0 ? rows : [...DEFAULT_FINISHES]
  return source.map((item, index) => ({
    slug: item.slug,
    name: `Acabado ${index + 1}`,
  }))
}

export function TypologyAssetsModal({ isOpen, onClose }: TypologyAssetsModalProps) {
  const [typologies, setTypologies] = useState<TypologyImport[]>([])
  const [code, setCode] = useState('')
  const [kind, setKind] = useState<TypologyAssetKind>('plano')
  const [tab, setTab] = useState<'ambientes' | 'vistas' | 'documentos'>('ambientes')
  const [roomSlots, setRoomSlots] = useState<TourRoomDef[]>([])
  const [finishes, setFinishes] = useState<{ slug: string; name: string }[]>([])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [uploadingRoom, setUploadingRoom] = useState<string | null>(null)
  const [jobs, setJobs] = useState<FileJob[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const roomFileRef = useRef<HTMLInputElement>(null)
  const pendingSlotRef = useRef<SceneSlot | null>(null)
  const modalScrollRef = useRef(0)
  const displayFinishes = labeledFinishes(finishes)
  const combos = sceneCombos(displayFinishes)

  const pickRoomFile = (slot: SceneSlot) => {
    if (!code || uploading) return
    pendingSlotRef.current = slot
    const scroller = document.querySelector('.crm-modal-panel .overflow-y-auto')
    modalScrollRef.current = scroller instanceof HTMLElement ? scroller.scrollTop : 0
    roomFileRef.current?.click()
    requestAnimationFrame(() => {
      if (scroller instanceof HTMLElement) scroller.scrollTop = modalScrollRef.current
    })
  }

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
    if (!isOpen) return
    const restore = () => {
      const scroller = document.querySelector('.crm-modal-panel .overflow-y-auto')
      if (scroller instanceof HTMLElement) scroller.scrollTop = modalScrollRef.current
    }
    window.addEventListener('focus', restore)
    document.addEventListener('visibilitychange', restore)
    return () => {
      window.removeEventListener('focus', restore)
      document.removeEventListener('visibilitychange', restore)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !code) return
    void loadAssets(code)
  }, [isOpen, code, loadAssets])

  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    void fetch('/api/tour/catalog')
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data: {
            finishes?: { slug: string; name: string }[]
            typologies?: { code: string; rooms?: TourRoomDef[] }[]
          } | null,
        ) => {
          if (cancelled || !data) return
          setFinishes(data.finishes ?? [])
          const rooms = data.typologies?.find((item) => item.code === code)?.rooms ?? []
          setRoomSlots(rooms.map((item) => ({ slug: item.slug, label: item.label })))
        },
      )
      .catch(() => {
        if (!cancelled) {
          setRoomSlots([])
          setFinishes([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [isOpen, code])

  const uploadOne = async (
    file: File,
    nextKind: TypologyAssetKind = kind,
    room?: string,
    finish?: string | null,
    light?: TourLightMode | null,
  ): Promise<FileJob['status']> => {
    const body = new FormData()
    body.set('typology_code', code)
    body.set('kind', nextKind)
    body.set('file', file)
    if (room) body.set('room', room)
    if (finish) body.set('finish', finish)
    if (light) body.set('light', light)

    let res: Response
    try {
      res = await fetch('/api/typology-assets/upload', {
        method: 'POST',
        body,
        credentials: 'same-origin',
      })
    } catch {
      throw new Error(
        'Se cortó la subida. Si es un 360, mandalo en JPG de 8192×4096 (mejor menos de 25 MB, no PNG).',
      )
    }
    const raw = await res.text()
    let payload: { error?: string; code?: string } = {}
    try {
      payload = raw ? (JSON.parse(raw) as { error?: string; code?: string }) : {}
    } catch {
      throw new Error(
        'El servidor no pudo procesar esa imagen. Probá JPG más liviano; el 360 ideal es 8192×4096.',
      )
    }

    if (res.status === 409 || payload.code === 'duplicate') return 'duplicate'
    if (!res.ok) throw new Error(payload.error || `Error al subir (${res.status})`)
    return 'done'
  }

  const onFiles = async (list: FileList | File[] | null, nextKind: TypologyAssetKind = kind) => {
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
      text: `Subiendo ${pngs.length} archivo(s) a ${code}…`,
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
        const status = await uploadOne(file, nextKind)
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
      setNotice({ tone: 'ok', text: `Guardado. ${ok} imagen(es) en ${code}.` })
    } else {
      setNotice({
        tone: fail ? 'error' : 'warn',
        text: `Resultado: ${ok} guardada(s), ${dup} duplicada(s), ${fail} con error. Revisa la lista de abajo.`,
      })
    }
  }

  const onRoomFile = async (slot: SceneSlot, file: File) => {
    if (!code) {
      toast.error('Selecciona una tipología primero')
      return
    }
    setUploading(true)
    setUploadingRoom(`${slot.room}:${slot.finish ?? ''}:${slot.light}`)
    setNotice({
      tone: 'info',
      text:
        slot.room === TOUR_PANO_SLUG
          ? `Subiendo el 360 · ${slot.label} de ${code}…`
          : `Subiendo ${slot.room} · ${slot.label} para ${code}…`,
    })
    try {
      const limit = slot.room === TOUR_PANO_SLUG ? TYPOLOGY_PANO_MAX_BYTES : TYPOLOGY_ASSET_MAX_BYTES
      if (file.size > limit) {
        throw new Error(`Supera ${limit / (1024 * 1024)} MB`)
      }
      await uploadOne(file, 'ambiente', slot.room, slot.finish, slot.light)
      toast.success(`${slot.room === TOUR_PANO_SLUG ? '360' : slot.room} · ${slot.label} guardado`)
      setNotice({
        tone: 'ok',
        text: `Listo. En el showroom, ${slot.label} usa esa imagen en ${slot.room === TOUR_PANO_SLUG ? 'el 360' : slot.room}.`,
      })
      await loadAssets(code)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'No se pudo subir'
      toast.error(message)
      setNotice({ tone: 'error', text: message })
    } finally {
      setUploading(false)
      setUploadingRoom(null)
    }
  }

  const findSlotAsset = (room: string, finish: string | null, light: TourLightMode) => {
    const exact = assets.find((row) => fileMatchesScene(row.file_name, room, finish, light))
    if (exact) return exact
    const defaultFinish = displayFinishes[0]?.slug ?? null
    const isDefaultSlot = light === 'dia' && (finish == null || finish === defaultFinish)
    if (!isDefaultSlot) return undefined
    return findLegacyRoomAsset(assets, room)
  }

  const onDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const target = assets.find((row) => row.id === id)
      const parsed = target ? parseRoomSceneFileName(target.file_name) : null
      const siblings =
        target && parsed?.light
          ? assets.filter((row) =>
              fileMatchesScene(row.file_name, parsed.room, parsed.finish, parsed.light ?? 'dia'),
            )
          : target
            ? [target]
            : []
      const toDelete = (siblings.length > 0 ? siblings : target ? [target] : []).map((row) => row.id)
      for (const assetId of toDelete) {
        await deleteTypologyAssetAction(assetId)
      }
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
        <div className="sticky top-0 z-10 -mx-4 -mt-4 space-y-3 border-b border-[#2B1A18]/8 bg-white px-4 pb-3 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6">
          {notice ? (
            <div
              className={cn(
                'rounded-md border px-3 py-2 text-sm',
                notice.tone === 'ok' && 'border-[#2B1A18]/10 bg-[#f4f4ef] text-[#555850]',
                notice.tone === 'error' && 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
                notice.tone === 'warn' && 'border-[#2B1A18]/10 bg-[#f7f3ee] text-[#7a6240]',
                notice.tone === 'info' && 'border-[#2B1A18]/10 bg-[#f4f4ef] text-[#555850]',
              )}
            >
              {notice.text}
            </div>
          ) : null}

          <div className="flex gap-1 border-b border-[#2B1A18]/10">
            {(
              [
                { id: 'ambientes' as const, label: 'Ambientes' },
                { id: 'vistas' as const, label: 'Vistas' },
                { id: 'documentos' as const, label: 'Planos' },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setTab(item.id)
                  if (item.id === 'vistas') setKind('render')
                  if (item.id === 'documentos') setKind('plano')
                }}
                className={cn(
                  'border-b-2 px-3 py-1.5 text-sm',
                  tab === item.id
                    ? 'border-[#2B1A18]/40 text-[#3a3d36]'
                    : 'border-transparent text-[#8a8d87] hover:text-[#3a3d36]',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <Select
            label="Tipología"
            options={typologyOptions}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        {tab === 'ambientes' && (
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm text-[#3a3d36]">360</p>
              <p className="text-xs text-[#8a8d87]">
                Cualquier imagen sirve por ahora (pruebas). Máx. {PANO_MAX_MB} MB
              </p>
              <div className="grid grid-cols-2 gap-3">
                {combos.map((combo) => {
                  const slot: SceneSlot = {
                    room: TOUR_PANO_SLUG,
                    finish: combo.finish,
                    light: combo.light,
                    label: combo.label,
                  }
                  const asset = findSlotAsset(TOUR_PANO_SLUG, combo.finish, combo.light)
                  const fallback = Boolean(asset && isLegacySceneFile(asset.file_name, TOUR_PANO_SLUG))
                  const busy = uploadingRoom === `${TOUR_PANO_SLUG}:${combo.finish ?? ''}:${combo.light}`
                  return (
                    <button
                      key={`${combo.finish ?? 'base'}-${combo.light}`}
                      type="button"
                      disabled={!code || uploading}
                      onClick={() => pickRoomFile(slot)}
                      className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-[#2B1A18]/10 bg-white text-left disabled:opacity-60"
                    >
                      <div className="relative aspect-[2/1] bg-[#f4f4ef]">
                        {asset ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={asset.public_url} alt={`360 ${combo.label}`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-[#8a8d87]">
                            Sin 360
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 p-2">
                        <span className="text-sm text-[#3a3d36]">{combo.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-[#787D62]">
                            {busy ? 'Subiendo…' : fallback ? 'Ya cargada' : asset ? 'Cambiar' : 'Subir'}
                          </span>
                          {asset && (
                            <span
                              role="button"
                              tabIndex={0}
                              className="rounded p-1 text-[#8a8d87] hover:bg-[#f3eaea] hover:text-[#8a5c58]"
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                if (deletingId === asset.id) return
                                void onDelete(asset.id)
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== 'Enter' && event.key !== ' ') return
                                event.preventDefault()
                                event.stopPropagation()
                                void onDelete(asset.id)
                              }}
                              aria-label={`Borrar 360 ${combo.label}`}
                            >
                              <Trash2 size={14} />
                            </span>
                          )}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-sm text-[#3a3d36]">Ambientes</p>
              <p className="text-xs text-[#8a8d87]">Acabado 1 y 2, día y noche. Las fotos viejas van a Acabado 1 · Día.</p>
            </div>
            {roomSlots.length === 0 ? (
              <p className="text-sm text-[#8a8d87]">
                Esta tipología todavía no tiene unidades con espacios, habitaciones o baños cargados.
              </p>
            ) : null}
            <div className="space-y-5">
              {roomSlots.map((item) => (
                <div key={item.slug} className="space-y-2">
                  <p className="text-sm text-[#3a3d36]">{item.label}</p>
                  <div className="grid grid-cols-2 gap-3">
                    {combos.map((combo) => {
                      const slot: SceneSlot = {
                        room: item.slug,
                        finish: combo.finish,
                        light: combo.light,
                        label: combo.label,
                      }
                      const asset = findSlotAsset(item.slug, combo.finish, combo.light)
                      const fallback = Boolean(asset && isLegacySceneFile(asset.file_name, item.slug))
                      const busy = uploadingRoom === `${item.slug}:${combo.finish ?? ''}:${combo.light}`
                      return (
                        <button
                          key={`${item.slug}-${combo.finish ?? 'base'}-${combo.light}`}
                          type="button"
                          disabled={!code || uploading}
                          onClick={() => pickRoomFile(slot)}
                          className="flex cursor-pointer flex-col overflow-hidden rounded-lg border border-[#2B1A18]/10 bg-white text-left disabled:opacity-60"
                        >
                          <div className="relative aspect-[16/10] bg-[#f4f4ef]">
                            {asset ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={asset.public_url} alt={`${item.label} ${combo.label}`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-[#8a8d87]">
                                Sin foto
                              </div>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 p-2">
                            <span className="text-xs text-[#3a3d36]">{combo.label}</span>
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-[#787D62]">
                                {busy ? 'Subiendo…' : fallback ? 'Ya cargada' : asset ? 'Cambiar' : 'Subir'}
                              </span>
                              {asset && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  className="rounded p-1 text-[#8a8d87] hover:bg-[#f3eaea] hover:text-[#8a5c58]"
                                  onClick={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    if (deletingId === asset.id) return
                                    void onDelete(asset.id)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key !== 'Enter' && event.key !== ' ') return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    void onDelete(asset.id)
                                  }}
                                  aria-label={`Borrar ${item.label} ${combo.label}`}
                                >
                                  <Trash2 size={14} />
                                </span>
                              )}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        )}

        {tab === 'vistas' && (
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-sm text-[#3a3d36]">Vistas</p>
              <p className="text-xs text-[#8a8d87]">
                Renders planos por ambiente. Acabado 1 y 2, día y noche.
              </p>
            </div>
            {roomSlots.length === 0 ? (
              <p className="text-sm text-[#8a8d87]">
                Esta tipología todavía no tiene ambientes cargados.
              </p>
            ) : null}
            <div className="space-y-5">
              {roomSlots.map((item) => {
                const slug = vistaRoomSlug(item.slug)
                return (
                  <div key={slug} className="space-y-2">
                    <p className="text-sm text-[#3a3d36]">{item.label}</p>
                    <div className="grid grid-cols-2 gap-3">
                      {combos.map((combo) => {
                        const slot: SceneSlot = {
                          room: slug,
                          finish: combo.finish,
                          light: combo.light,
                          label: combo.label,
                        }
                        const asset = findSlotAsset(slug, combo.finish, combo.light)
                        const fallback = Boolean(asset && isLegacySceneFile(asset.file_name, slug))
                        const busy = uploadingRoom === `${slug}:${combo.finish ?? ''}:${combo.light}`
                        return (
                          <button
                            key={`${slug}-${combo.finish ?? 'base'}-${combo.light}`}
                            type="button"
                            disabled={!code || uploading}
                            onClick={() => pickRoomFile(slot)}
                            className="flex cursor-pointer flex-col overflow-hidden rounded-md border border-[#2B1A18]/10 bg-white text-left disabled:opacity-60"
                          >
                            <div className="relative aspect-[16/10] bg-[#f4f4ef]">
                              {asset ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={asset.public_url}
                                  alt={`${item.label} ${combo.label}`}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center text-xs text-[#8a8d87]">
                                  Sin render
                                </div>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2 p-2">
                              <span className="text-xs text-[#3a3d36]">{combo.label}</span>
                              <span className="flex items-center gap-2">
                                <span className="text-xs text-[#787D62]">
                                  {busy ? 'Subiendo…' : fallback ? 'Ya cargada' : asset ? 'Cambiar' : 'Subir'}
                                </span>
                                {asset && (
                                  <span
                                    role="button"
                                    tabIndex={0}
                                    className="rounded p-1 text-[#8a8d87] hover:bg-[#f3eaea] hover:text-[#8a5c58]"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      event.stopPropagation()
                                      if (deletingId === asset.id) return
                                      void onDelete(asset.id)
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key !== 'Enter' && event.key !== ' ') return
                                      event.preventDefault()
                                      event.stopPropagation()
                                      void onDelete(asset.id)
                                    }}
                                    aria-label={`Borrar ${item.label} ${combo.label}`}
                                  >
                                    <Trash2 size={14} />
                                  </span>
                                )}
                              </span>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-[#8a8d87]">Otra vista (fachada, amenidad, etc.)</p>
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-sm',
                dragging
                  ? 'border-[#2B1A18]/30 bg-[#f4f4ef] text-[#3a3d36]'
                  : 'border-[#2B1A18]/15 bg-[#fafaf7] text-[#555850]',
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
                void onFiles(Array.from(e.dataTransfer.files), 'render')
              }}
            >
              <ImagePlus size={18} className="text-[#8a8d87]" />
              <span>Soltá acá o elegí archivo</span>
              <span className="text-xs text-[#8a8d87]">PNG, JPG o WebP · máx. {MAX_MB} MB</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                multiple
                disabled={!code || uploading}
                className="mt-1 w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#3a3d36] file:px-3 file:py-1.5 file:text-xs file:text-white"
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : []
                  e.target.value = ''
                  void onFiles(files, 'render')
                }}
              />
            </div>
            {jobs.length > 0 && tab === 'vistas' ? (
              <ul className="space-y-1 text-sm">
                {jobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 rounded-md border border-[#2B1A18]/8 px-3 py-1.5">
                    <span className="min-w-0 truncate">{job.name}</span>
                    <span className="shrink-0 text-xs text-[#8a8d87]">
                      {job.status === 'pending' && 'En cola'}
                      {job.status === 'uploading' && 'Subiendo…'}
                      {job.status === 'done' && 'Listo'}
                      {job.status === 'duplicate' && (job.message ?? 'Duplicado')}
                      {job.status === 'error' && (job.message ?? 'Error')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div>
              {loadingList ? (
                <p className="text-sm text-[#8a8d87]">Cargando…</p>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {assets
                    .filter(
                      (asset) =>
                        asset.kind !== 'plano' &&
                        !isTourPanoramaFileName(asset.file_name) &&
                        !roomSlots.some(
                          (room) =>
                            assetMatchesRoom(asset.file_name, room.slug) ||
                            assetMatchesRoom(asset.file_name, vistaRoomSlug(room.slug)),
                        ),
                    )
                    .map((asset) => (
                      <li key={asset.id} className="overflow-hidden rounded-md border border-[#2B1A18]/8 bg-white">
                        <div className="relative aspect-[4/3] bg-[#f4f4ef]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={asset.public_url} alt={asset.file_name} className="h-full w-full object-cover" />
                        </div>
                        <div className="flex items-center justify-between gap-2 p-2">
                          <p className="min-w-0 truncate text-xs text-[#3a3d36]">{asset.file_name}</p>
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
            </div>
          </div>
        )}

        {tab === 'documentos' && (
        <div className="space-y-4">
        <p className="text-xs text-[#8a8d87]">Planos de la tipología.</p>
        <div
          className={cn(
            'flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-sm',
            dragging
              ? 'border-[#2B1A18]/30 bg-[#f4f4ef] text-[#3a3d36]'
              : 'border-[#2B1A18]/15 bg-[#fafaf7] text-[#555850]',
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
            void onFiles(Array.from(e.dataTransfer.files), 'plano')
          }}
        >
          <ImagePlus size={18} className="text-[#8a8d87]" />
          <span>Soltá acá o elegí archivo</span>
          <span className="text-xs text-[#8a8d87]">PNG, JPG o WebP · máx. {MAX_MB} MB</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            multiple
            disabled={!code || uploading}
            className="mt-1 w-full max-w-sm text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[#3a3d36] file:px-3 file:py-1.5 file:text-xs file:text-white"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : []
              e.target.value = ''
              void onFiles(files, 'plano')
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
              {assets
                .filter((asset) => asset.kind === 'plano')
                .map((asset) => (
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
        </div>
        )}

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
        <input
          ref={roomFileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          tabIndex={-1}
          className="pointer-events-none fixed top-0 left-0 h-px w-px opacity-0"
          onChange={(e) => {
            const file = e.target.files?.[0]
            const slot = pendingSlotRef.current
            e.target.value = ''
            pendingSlotRef.current = null
            const scroller = document.querySelector('.crm-modal-panel .overflow-y-auto')
            if (scroller instanceof HTMLElement) scroller.scrollTop = modalScrollRef.current
            if (file && slot) void onRoomFile(slot, file)
          }}
        />
      </div>
    </Modal>
  )
}
