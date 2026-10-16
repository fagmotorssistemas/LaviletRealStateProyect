'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ImagePlus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import { storageCacheControl } from '@/lib/storage/cacheControl'
import type { ConstructionMedia, ConstructionUpdate } from '@/lib/tour/constructionProgress'

function localToday() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function AvanceDeObraPage() {
  const { canWrite } = useRoleAccess()
  const [items, setItems] = useState<ConstructionUpdate[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [date, setDate] = useState(localToday)
  const [description, setDescription] = useState('')
  const [media, setMedia] = useState<ConstructionMedia[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)

  const resetEditor = () => {
    setEditingId(null)
    setDate(localToday())
    setDescription('')
    setMedia([])
  }

  const edit = (item: ConstructionUpdate) => {
    setEditingId(item.id)
    setDate(item.date)
    setDescription(item.description ?? '')
    setMedia(item.media.map(file => ({ ...file })))
    document.getElementById('construction-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const load = useCallback(async () => {
    const response = await fetch('/api/tour/construction-updates', { cache: 'no-store' })
    const data = (await response.json().catch(() => null)) as { items?: ConstructionUpdate[]; error?: string } | null
    if (!response.ok) throw new Error(data?.error || 'No se pudo consultar el avance de obra')
    setItems(data?.items ?? [])
  }, [])

  useEffect(() => {
    let active = true
    void load()
      .catch((error) => {
        if (active) toast.error(error instanceof Error ? error.message : 'No se pudo consultar el avance de obra')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [load])

  const uploadOne = async (file: File): Promise<ConstructionMedia> => {
    const prepResponse = await fetch('/api/tour/construction-updates/prepare', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file.name, mime: file.type, size: file.size }),
    })
    const prep = (await prepResponse.json().catch(() => null)) as {
      error?: string; bucket?: string; path?: string; token?: string; storage_path?: string;
      file_name?: string; content_type?: string
    } | null
    if (!prepResponse.ok || !prep?.bucket || !prep.path || !prep.token || !prep.storage_path || !prep.file_name) {
      throw new Error(prep?.error || 'No se pudo preparar la subida')
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Falta configuración de Supabase en el cliente')
    const { createClient } = await import('@supabase/supabase-js')
    const uploadClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: uploadError } = await uploadClient.storage.from(prep.bucket).uploadToSignedUrl(
      prep.path,
      prep.token,
      file,
      { contentType: prep.content_type || file.type, cacheControl: storageCacheControl(prep.file_name) },
    )
    if (uploadError) throw new Error(uploadError.message || 'No se pudo subir el archivo')

    const convertResponse = await fetch('/api/tour/construction-updates/convert', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: prep.storage_path, file_name: prep.file_name }),
    })
    const converted = (await convertResponse.json().catch(() => null)) as {
      type?: 'image' | 'video'; url?: string; error?: string
    } | null
    if (!convertResponse.ok || !converted?.type || !converted.url) {
      throw new Error(converted?.error || 'No se pudo procesar el archivo')
    }
    return { type: converted.type, url: converted.url, caption: '' }
  }

  const onFiles = async (files: FileList | null, replaceIndex?: number) => {
    if (!files?.length) return
    if (media.length + (replaceIndex === undefined ? files.length : 0) > 30) {
      toast.error('Máximo 30 archivos por entrada')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files).slice(0, replaceIndex === undefined ? files.length : 1)) {
        const next = await uploadOne(file)
        setMedia((current) => replaceIndex === undefined ? [...current, next] : current.map((old, index) => index === replaceIndex ? next : old))
      }
      toast.success('Archivos listos para publicar')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron subir los archivos')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!date || !media.length) {
      toast.error('Agrega la fecha y al menos una foto o video')
      return
    }
    setSaving(true)
    try {
      const response = await fetch(editingId ? `/api/tour/construction-updates/${editingId}` : '/api/tour/construction-updates', {
        method: editingId ? 'PATCH' : 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, description, media }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'No se pudo publicar el avance')
      resetEditor()
      await load()
      toast.success(editingId ? 'Avance de obra actualizado' : 'Avance de obra publicado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo publicar el avance')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: ConstructionUpdate) => {
    if (!window.confirm(`¿Borrar el avance del ${item.date} y sus archivos?`)) return
    setDeleting(item.id)
    try {
      const response = await fetch(`/api/tour/construction-updates/${item.id}`, {
        method: 'DELETE', credentials: 'same-origin',
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'No se pudo borrar')
      setItems((current) => current.filter((row) => row.id !== item.id))
      toast.success('Entrada borrada')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar la entrada')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="crm-title">Avance de obra</h1>
          <p className="text-sm text-[#8a8d87]">Fotos y videos fechados que aparecen en el menú del showroom.</p>
        </div>
        <Link href="/inmobiliaria/inventario" className="inline-flex items-center gap-1.5 text-sm text-[#555850] hover:text-[#3a3d36]">
          <ArrowLeft size={16} /> Inventario
        </Link>
      </div>

      {canWrite ? (
        <section id="construction-editor" aria-busy={saving || uploading} className="scroll-mt-24 space-y-3 rounded-xl border border-[#2B1A18]/10 bg-white p-3 sm:p-4">
          <h2 className="text-lg font-semibold text-[#2B1A18]">{editingId ? 'Editar avance de obra' : 'Nueva entrada'}</h2>
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="space-y-1 text-sm text-[#3a3d36]">Fecha
              <input type="date" value={date} disabled={saving || uploading} onChange={(event) => setDate(event.target.value)} className="block h-10 w-full rounded-md border border-[#2B1A18]/20 px-3" />
            </label>
            <label className="space-y-1 text-sm text-[#3a3d36]">Descripción
              <textarea aria-label="Descripción" value={description} disabled={saving || uploading} onChange={(event) => setDescription(event.target.value)} maxLength={5000} rows={2} placeholder="Describe el avance de la obra" className="block min-h-10 w-full resize-y rounded-md border border-[#2B1A18]/20 px-3 py-2" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#2B1A18]/20 bg-[#f7f6f2] px-3 py-2 text-sm text-[#3a3d36]">
              <ImagePlus size={18} /> {uploading ? 'Subiendo archivos…' : 'Agregar fotos o videos'}
              <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple disabled={uploading || saving} className="hidden" onChange={(event) => { void onFiles(event.target.files); event.target.value = '' }} />
            </label>
            <button type="button" onClick={() => void save()} disabled={uploading || saving || !media.length} className="min-h-10 rounded-full bg-[#BDA27E] px-5 text-sm font-semibold text-[#2B1A18] disabled:opacity-50">
              {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Publicar avance'}
            </button>
            {editingId ? <button type="button" onClick={resetEditor} disabled={uploading || saving} className="min-h-10 rounded-full border border-[#2B1A18]/20 px-5 text-sm text-[#555850] disabled:opacity-50">Cancelar edición</button> : null}
          </div>
          {media.length ? (
            <div className="flex flex-wrap gap-2">
              {media.map((item, index) => (
                <figure key={item.url} className="flex w-48 max-w-full flex-none flex-col overflow-hidden rounded-md border border-[#2B1A18]/10 bg-white">
                  <div className="relative aspect-[4/3] bg-[#f4f4ef]">
                    {item.type === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url} alt="" className="h-full w-full object-cover" />
                    ) : <video src={item.url} controls preload="metadata" className="h-full w-full object-cover" />}
                    <button type="button" aria-label="Quitar archivo" disabled={uploading || saving} onClick={() => setMedia((current) => current.filter((row) => row.url !== item.url))} className="absolute top-2 right-2 rounded-full bg-white/95 p-1.5 text-[#8a5c58] shadow-sm disabled:opacity-50"><Trash2 size={16} /></button>
                  </div>
                  <label className="cursor-pointer px-3 py-2 text-center text-xs font-medium text-[#555850] hover:bg-[#f7f3ee]">
                    Cambiar archivo
                    <input type="file" aria-label={`Cambiar archivo ${index + 1}`} accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" disabled={uploading || saving} className="hidden" onChange={event => { void onFiles(event.target.files, index); event.target.value = '' }} />
                  </label>
                </figure>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#2B1A18]">Entradas publicadas</h2>
        {loading ? <p className="text-sm text-[#8a8d87]">Cargando…</p> : null}
        {!loading && !items.length ? <p className="text-sm text-[#8a8d87]">Todavía no hay avances publicados.</p> : null}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-4">
        {items.map((item) => (
          <article key={item.id} className="flex h-[22rem] min-w-0 flex-col gap-3 rounded-xl border border-[#2B1A18]/10 bg-white p-4">
            <div className="flex h-9 shrink-0 items-start justify-between gap-3">
              <time dateTime={item.date} className="text-xs text-[#8a8d87]">{item.date}</time>
              {canWrite ? <div className="flex gap-1">
                <button type="button" aria-label={`Editar avance del ${item.date}`} disabled={uploading || saving || deleting !== null} onClick={() => edit(item)} className="rounded-full p-2 text-[#8e7654] hover:bg-[#f7f3ee] disabled:opacity-50"><Pencil size={18} /></button>
                <button type="button" aria-label={`Borrar avance del ${item.date}`} disabled={uploading || saving || deleting !== null || editingId === item.id} onClick={() => void remove(item)} className="rounded-full p-2 text-[#8a5c58] disabled:opacity-50"><Trash2 size={18} /></button>
              </div> : null}
            </div>
            <p className="h-10 shrink-0 overflow-y-auto text-sm leading-5 break-words text-[#555850]">{item.description}</p>
            <div className="flex min-h-0 flex-1 snap-x snap-mandatory gap-2 overflow-x-auto">
              {item.media.map((file) => <figure key={file.url} className="h-full w-full flex-none snap-start overflow-hidden rounded-md border border-[#2B1A18]/10 bg-white">
                <div className="relative h-full bg-[#f4f4ef]">
                  {file.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={file.url} alt="" className="h-full w-full object-cover" />
                  ) : <video src={file.url} controls preload="metadata" className="h-full w-full object-cover" />}
                </div>
              </figure>)}
            </div>
          </article>
        ))}
        </div>
      </section>
    </div>
  )
}
