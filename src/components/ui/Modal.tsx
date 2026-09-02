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
      <div className="crm-modal-backdrop fixed inset-0 bg-[#2B1A18]/40" onClick={onClose} />
      <div
        className={cn(
          'crm-modal-panel relative z-50 flex max-h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(43,26,24,0.18)] ring-1 ring-[#2B1A18]/8 sm:mx-4 sm:max-h-[90vh] sm:rounded-2xl',
          sizeClasses[size],
          className,
        )}
      >
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#2B1A18]/8 bg-[#f7f3ee] px-4 py-3 sm:px-6">
            <h2 className="min-w-0 flex-1 truncate font-display text-lg font-medium tracking-tight text-[#2B1A18] sm:text-xl">
              {title}
            </h2>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer p-1.5 text-[#2B1A18]/40 transition-colors hover:text-[#BDA27E]"
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
