'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { startTourAccessAction } from '@/app/(auth)/tour-access/actions'
import { createClient } from '@/lib/supabase/client'
import { TOUR_INTEREST_OPTIONS } from '@/lib/marketing/visitanteIdentity'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

export function TourAccessForm({ onOpened }: { onOpened?: () => void }) {
  const router = useRouter()
  const [mode, setMode] = useState<'first' | 'returning'>('first')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    try {
      const result = await startTourAccessAction({
        mode,
        name: String(data.get('name') ?? ''),
        email: String(data.get('email') ?? ''),
        phone: String(data.get('phone') ?? ''),
        interest: String(data.get('interest') ?? ''),
        message: String(data.get('message') ?? ''),
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: result.email,
        password: result.password,
      })
      if (error) {
        toast.error(error.message)
        return
      }
      toast.success(
        mode === 'returning' ? 'Bienvenido de nuevo. Sigue recorriendo el showroom.' : 'Listo. Ya puedes recorrer el showroom.',
      )
      onOpened?.()
      router.replace('/cuenta')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#2B1A18]/6 p-1">
        <button
          type="button"
          onClick={() => setMode('first')}
          className={cn(
            'rounded-lg px-3 py-2 text-[11px] font-medium tracking-[0.12em] uppercase transition-colors',
            mode === 'first' ? 'bg-white text-[#2B1A18] shadow-sm' : 'text-[#2B1A18]/50 hover:text-[#2B1A18]',
          )}
        >
          Primera visita
        </button>
        <button
          type="button"
          onClick={() => setMode('returning')}
          className={cn(
            'rounded-lg px-3 py-2 text-[11px] font-medium tracking-[0.12em] uppercase transition-colors',
            mode === 'returning' ? 'bg-white text-[#2B1A18] shadow-sm' : 'text-[#2B1A18]/50 hover:text-[#2B1A18]',
          )}
        >
          Ya llené el formulario
        </button>
      </div>

      {mode === 'first' && (
        <>
          <Input id="tour-name" name="name" label="Nombre" placeholder="Tu nombre" autoComplete="name" required />
          <Input
            id="tour-email"
            name="email"
            label="Correo electrónico"
            type="email"
            placeholder="tucorreo@email.com"
            autoComplete="email"
            required
          />
        </>
      )}
      <Input
        id="tour-phone"
        name="phone"
        label="Celular"
        type="tel"
        placeholder="099 000 0000"
        autoComplete="tel"
        required
      />
      {mode === 'first' && (
        <>
          <Select
            id="tour-interest"
            name="interest"
            label="Qué buscas"
            placeholder="Selecciona una opción"
            options={[...TOUR_INTEREST_OPTIONS]}
            required
          />
          <Textarea
            id="tour-message"
            name="message"
            label="Mensaje"
            placeholder="Zona, presupuesto o lo que quieras contarnos"
            rows={4}
          />
        </>
      )}
      <Button type="submit" variant="gold" className="h-11 w-full" disabled={pending}>
        {pending
          ? 'Entrando al showroom…'
          : mode === 'returning'
            ? 'Seguir recorriendo'
            : 'Entrar al showroom 360°'}
      </Button>
      <p className="text-center text-xs text-[#2B1A18]/45">
        {mode === 'returning'
          ? 'Con el mismo celular de tu primera visita entras de nuevo al 360°.'
          : 'El correo no se verifica. Si vuelves, entra solo con tu celular.'}
      </p>
    </form>
  )
}
