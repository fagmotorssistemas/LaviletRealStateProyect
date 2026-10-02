'use client'

import { useCallback, useEffect, useState } from 'react'
import { ImagePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { storageCacheControl } from '@/lib/storage/cacheControl'

type AmenityItem = {
  name: string
  title: string
  imageUrl: string
}

export function AmenityUploadsPanel() {
  const [items, setItems] = useState<AmenityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    const response = await fetch('/api/tour/amenities', { cache: 'no-store' })
    const data = (await response.json().catch(() => null)) as { items?: AmenityItem[]; error?: string } | null
    if (!response.ok) throw new Error(data?.error || 'No se pudieron consultar las amenidades')
    setItems(data?.items ?? [])
  }, [])

  useEffect(() => {
    let cancelled = false
    void load()
      .catch((error) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : 'No se pudieron consultar las amenidades')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  const uploadOne = async (file: File) => {
    const prepRes = await fetch('/api/tour/amenities/prepare', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: file.name, mime: file.type || null, size: file.size }),
    })
    const prep = (await prepRes.json().catch(() => null)) as {
      error?: string
      bucket?: string
      path?: string
      token?: string
      storage_path?: string
      file_name?: string
      original_name?: string
      content_type?: string
    } | null
    if (!prepRes.ok || !prep?.bucket || !prep.path || !prep.token || !prep.storage_path || !prep.file_name) {
      throw new Error(prep?.error || 'No se pudo preparar la subida')
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !anonKey) throw new Error('Falta configuración de Supabase en el cliente.')
    const { createClient } = await import('@supabase/supabase-js')
    const uploadClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: upErr } = await uploadClient.storage.from(prep.bucket).uploadToSignedUrl(prep.path, prep.token, file, {
      contentType: prep.content_type || file.type || 'image/jpeg',
      cacheControl: storageCacheControl(prep.file_name),
    })
    if (upErr) throw new Error(upErr.message || 'No se pudo subir el archivo')

    const convertRes = await fetch('/api/tour/amenities/convert', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storage_path: prep.storage_path,
        file_name: prep.file_name,
        original_name: prep.original_name || file.name,
      }),
    })
    const converted = (await convertRes.json().catch(() => null)) as { error?: string } | null
    if (!convertRes.ok) throw new Error(converted?.error || 'No se pudo convertir a WebP')
  }

  const onFiles = async (list: FileList | null) => {
    const files = [...(list ?? [])].filter(
      (file) => file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name),
    )
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        await uploadOne(file)
      }
      await load()
      toast.success(files.length === 1 ? 'Amenidad lista en la galería' : 'Amenidades listas en la galería')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo subir la amenidad')
    } finally {
      setUploading(false)
    }
  }

  const onDelete = async (item: AmenityItem) => {
    setDeleting(item.name)
    try {
      const response = await fetch('/api/tour/amenities', {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: item.name }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(data?.error || 'No se pudo borrar')
      setItems((prev) => prev.filter((row) => row.name !== item.name))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo borrar')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-sm text-[#3a3d36]">Amenidades</p>
        <p className="text-xs text-[#8a8d87]">
          Estas fotos se ven en el menú del showroom. Se sube el original y se guarda en WebP sin pérdida.
          El nombre del archivo es el texto de la foto (por ejemplo, Piscina o Gimnasio).
        </p>
      </div>
      <label className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-[#2B1A18]/20 bg-[#f7f6f2] px-4 py-8 text-sm text-[#3a3d36]">
        <ImagePlus size={16} />
        {uploading ? 'Subiendo y convirtiendo…' : 'Subir fotos de amenidades'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          disabled={uploading}
          className="hidden"
          onChange={(event) => {
            void onFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </label>
      {loading ? <p className="text-sm text-[#8a8d87]">Cargando…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-[#8a8d87]">Todavía no hay fotos de amenidades.</p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.name} className="overflow-hidden rounded-md border border-[#2B1A18]/10 bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.title} className="aspect-[4/3] w-full object-cover" />
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="min-w-0 truncate text-[11px] text-[#3a3d36]">{item.title}</span>
              <button
                type="button"
                className="text-[#8a8d87] hover:text-[#8a5c58] disabled:opacity-50"
                aria-label={`Borrar ${item.title}`}
                disabled={deleting === item.name}
                onClick={() => void onDelete(item)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
