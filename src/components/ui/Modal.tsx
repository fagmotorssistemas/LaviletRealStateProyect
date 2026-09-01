'use client'

import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  headerActions?: ReactNode
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

const sizeClasses = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  full: 'sm:max-w-6xl',
}

export function Modal({ isOpen, onClose, title, headerActions, children, className, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="crm-modal-backdrop fixed inset-0 bg-[#3a3d36]/35" onClick={onClose} />
      <div
        className={cn(
          'crm-modal-panel relative z-50 flex max-h-[100dvh] w-full flex-col overflow-hidden border border-[#c5c8bc] bg-white shadow-[0_24px_60px_rgba(85,92,74,0.18)] sm:mx-4 sm:max-h-[90vh]',
          sizeClasses[size],
          className,
        )}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#555c4a]/40 bg-[#555c4a] px-4 py-3 sm:px-6">
            <h2 className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-wide text-[#f4f4ef] sm:text-xl">
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer p-1.5 text-[#c5c8bc] transition-colors hover:bg-white/10 hover:text-[#f4f4ef]"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
