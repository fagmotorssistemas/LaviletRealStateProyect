'use client'

import { Modal } from '@/components/ui/Modal'
import { TourAccessForm } from './TourAccessForm'

export function TourAccessModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Solicita información" size="md">
      <p className="mb-5 text-sm text-[#2B1A18]/60">
        Primera vez: deja tus datos y entra al 360°. Si ya llenaste el formulario, solo pon tu celular.
      </p>
      <TourAccessForm onOpened={onClose} />
    </Modal>
  )
}
