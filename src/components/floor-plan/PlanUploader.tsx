'use client'

import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

type PlanUploaderProps = {
  disabled?: boolean
  onFile: (file: File) => void
}

export function PlanUploader({ disabled, onFile }: PlanUploaderProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[#2B1A18]/20 bg-white px-6 py-10 text-center transition-colors hover:border-[#BDA27E]/60 hover:bg-[#faf7f2]',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <Upload className="text-[#787D62]" size={22} />
      <span className="text-sm font-medium text-[#2B1A18]">Subí un plano (JPG, PNG, WEBP)</span>
      <span className="text-xs text-[#2B1A18]/45">La imagen original no se modifica</span>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp"
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onFile(file)
          event.target.value = ''
        }}
      />
    </label>
  )
}
