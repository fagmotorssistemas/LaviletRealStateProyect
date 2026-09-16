'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { SITE } from '@/lib/marketing/site'

const INTEREST_OPTIONS = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'local', label: 'Local comercial' },
  { value: 'inversion', label: 'Inversión / preventa' },
  { value: 'otro', label: 'Aún no lo tengo claro' },
]

export function ContactForm() {
  const [pending, setPending] = useState(false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const data = new FormData(form)
    const name = String(data.get('name') ?? '').trim()
    const phone = String(data.get('phone') ?? '').trim()
    const interest = String(data.get('interest') ?? '').trim()
    const message = String(data.get('message') ?? '').trim()
    const interestLabel = INTEREST_OPTIONS.find((o) => o.value === interest)?.label ?? interest

    const body = [
      `Hola, soy ${name}.`,
      phone && `Mi teléfono es ${phone}.`,
      interestLabel && `Me interesa: ${interestLabel}.`,
      message && message,
      'Quisiera agendar una visita o que un asesor me contacte.',
    ]
      .filter(Boolean)
      .join('\n')

    setPending(true)
    try {
      if (SITE.whatsapp) {
        window.open(
          `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(body)}`,
          '_blank',
          'noopener,noreferrer',
        )
      } else {
        window.location.href = `mailto:${SITE.email}?subject=${encodeURIComponent(`Consulta Lavilet — ${name}`)}&body=${encodeURIComponent(body)}`
      }
      toast.success('Abrimos tu mensaje para enviarlo. Un asesor te contactará pronto.')
      form.reset()
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="contact-name"
        name="name"
        label="Nombre"
        placeholder="Tu nombre"
        autoComplete="name"
        required
      />
      <Input
        id="contact-phone"
        name="phone"
        label="Teléfono"
        type="tel"
        placeholder="099 000 0000"
        autoComplete="tel"
        required
      />
      <Select
        id="contact-interest"
        name="interest"
        label="Qué buscas"
        placeholder="Selecciona una opción"
        options={INTEREST_OPTIONS}
        required
      />
      <Textarea
        id="contact-message"
        name="message"
        label="Mensaje"
        placeholder="Cuéntanos zona, presupuesto o fecha para visitar el showroom"
        rows={4}
      />
      <Button type="submit" variant="gold" className="h-11 w-full" disabled={pending}>
        {pending ? 'Abriendo…' : SITE.whatsapp ? 'Escribir por WhatsApp' : 'Enviar consulta'}
      </Button>
      <p className="text-center text-xs text-[#2B1A18]/45">
        Al enviar, abriremos {SITE.whatsapp ? 'WhatsApp' : `tu correo hacia ${SITE.email}`} con los datos de esta consulta.
      </p>
    </form>
  )
}
