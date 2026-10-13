'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ImagePlus, Trash2 } from 'lucide-react'
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
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [media, setMedia] = useState<ConstructionMedia[]>([])

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
    return { type: converted.type, url: converted.url, caption: file.name.replace(/\.[^.]+$/, '') }
  }

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    if (media.length + files.length > 30) {
      toast.error('Máximo 30 archivos por entrada')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const next = await uploadOne(file)
        setMedia((current) => [...current, next])
      }
      toast.success('Archivos listos para publicar')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron subir los archivos')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!date || !title.trim() || !media.length) {
      toast.error('Agrega fecha, título y al menos una foto o video')
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/tour/construction-updates', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, title: title.trim(), description: description.trim(), media }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'No se pudo publicar el avance')
      setTitle('')
      setDescription('')
      setDate(localToday())
      setMedia([])
      await load()
      toast.success('Avance de obra publicado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo publicar el avance')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: ConstructionUpdate) => {
    if (!window.confirm(`¿Borrar “${item.title}” y sus archivos?`)) return
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
        <section className="space-y-4 rounded-xl border border-[#2B1A18]/10 bg-white p-4">
          <h2 className="text-lg font-semibold text-[#2B1A18]">Nueva entrada</h2>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <label className="space-y-1 text-sm text-[#3a3d36]">Fecha
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="block h-11 w-full rounded-md border border-[#2B1A18]/20 px-3" />
            </label>
            <label className="space-y-1 text-sm text-[#3a3d36]">Título
              <input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} className="block h-11 w-full rounded-md border border-[#2B1A18]/20 px-3" placeholder="Ej. Estructura del sexto piso" />
            </label>
          </div>
          <label className="block space-y-1 text-sm text-[#3a3d36]">Descripción
            <textarea value={description} maxLength={5000} onChange={(event) => setDescription(event.target.value)} rows={3} className="block w-full rounded-md border border-[#2B1A18]/20 p-3" />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#2B1A18]/20 bg-[#f7f6f2] px-4 py-6 text-sm text-[#3a3d36]">
            <ImagePlus size={18} /> {uploading ? 'Subiendo archivos…' : 'Agregar fotos o videos'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" multiple disabled={uploading || saving} className="hidden" onChange={(event) => { void onFiles(event.target.files); event.target.value = '' }} />
          </label>
          {media.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {media.map((item) => (
                <div key={item.url} className="overflow-hidden rounded-md border border-[#2B1A18]/10">
                  {item.type === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt={item.caption} className="aspect-video w-full object-cover" />
                  ) : <video src={item.url} controls preload="metadata" className="aspect-video w-full object-cover" />}
                  <div className="flex items-center gap-2 p-2">
                    <input aria-label="Descripción del archivo" value={item.caption} maxLength={300} onChange={(event) => setMedia((current) => current.map((row) => row.url === item.url ? { ...row, caption: event.target.value } : row))} className="min-w-0 flex-1 rounded border border-[#2B1A18]/15 px-2 py-1 text-sm" />
                    <button type="button" aria-label="Quitar archivo" onClick={() => setMedia((current) => current.filter((row) => row.url !== item.url))}><Trash2 size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <button type="button" onClick={() => void save()} disabled={uploading || saving || !media.length} className="min-h-11 rounded-full bg-[#BDA27E] px-6 text-sm font-semibold text-[#2B1A18] disabled:opacity-50">
            {saving ? 'Publicando…' : 'Publicar avance'}
          </button>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-[#2B1A18]">Entradas publicadas</h2>
        {loading ? <p className="text-sm text-[#8a8d87]">Cargando…</p> : null}
        {!loading && !items.length ? <p className="text-sm text-[#8a8d87]">Todavía no hay avances publicados.</p> : null}
        {items.map((item) => (
          <article key={item.id} className="space-y-3 rounded-xl border border-[#2B1A18]/10 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div><time dateTime={item.date} className="text-xs text-[#8a8d87]">{item.date}</time><h3 className="font-semibold text-[#2B1A18]">{item.title}</h3><p className="whitespace-pre-line text-sm text-[#555850]">{item.description}</p></div>
              {canWrite ? <button type="button" aria-label={`Borrar ${item.title}`} disabled={deleting === item.id} onClick={() => void remove(item)} className="rounded-full p-2 text-[#8a5c58] disabled:opacity-50"><Trash2 size={18} /></button> : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {item.media.map((file) => <figure key={file.url} className="overflow-hidden rounded-md border border-[#2B1A18]/10">
                {file.type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.url} alt={file.caption} className="aspect-video w-full object-cover" />
                ) : <video src={file.url} controls preload="metadata" className="aspect-video w-full object-cover" />}
                {file.caption ? <figcaption className="p-2 text-xs text-[#555850]">{file.caption}</figcaption> : null}
              </figure>)}
            </div>
          </article>
        ))}
      </section>
    </div>
  )
}
