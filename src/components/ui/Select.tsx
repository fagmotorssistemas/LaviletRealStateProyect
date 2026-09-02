'use client'

import { forwardRef, useEffect, useId, useMemo, useRef, useState, type SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, id, options, placeholder, value, defaultValue, onChange, disabled, name, required, ...props }, ref) => {
    const uid = useId()
    const selectId = id ?? uid
    const rootRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const isControlled = value !== undefined
    const [open, setOpen] = useState(false)
    const [internal, setInternal] = useState(String(defaultValue ?? ''))
    const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null)
    const current = isControlled ? String(value ?? '') : internal

    const selected = useMemo(
      () => options.find((option) => option.value === current),
      [options, current],
    )
    const display = selected?.label ?? placeholder ?? 'Seleccionar'
    const isPlaceholder = !selected

    const pick = (next: string) => {
      if (!isControlled) setInternal(next)
      setOpen(false)
      onChange?.({
        target: { value: next, name: name ?? '' },
        currentTarget: { value: next, name: name ?? '' },
      } as React.ChangeEvent<HTMLSelectElement>)
    }

    useEffect(() => {
      if (!open) return
      const update = () => {
        const node = buttonRef.current
        if (!node) return
        const rect = node.getBoundingClientRect()
        setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width })
      }
      update()
      const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node
        if (rootRef.current?.contains(target)) return
        if ((target as HTMLElement).closest('[data-select-menu]')) return
        setOpen(false)
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setOpen(false)
      }
      window.addEventListener('resize', update)
      document.addEventListener('scroll', update, true)
      document.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('keydown', onKeyDown)
      return () => {
        window.removeEventListener('resize', update)
        document.removeEventListener('scroll', update, true)
        document.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('keydown', onKeyDown)
      }
    }, [open])

    const menu =
      open && coords ? (
        <ul
          data-select-menu
          role="listbox"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
          className="fixed z-[80] max-h-64 overflow-y-auto border border-[#2B1A18]/12 bg-white py-1 shadow-[0_18px_40px_rgba(43,26,24,0.14)]"
        >
          {placeholder && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={isPlaceholder}
                onClick={() => pick('')}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition-colors',
                  isPlaceholder ? 'bg-[#f7f3ee] text-[#787D62]' : 'text-[#6e716b] hover:bg-[#f7f3ee]',
                )}
              >
                <span className="truncate">{placeholder}</span>
              </button>
            </li>
          )}
          {options.map((option) => {
            const active = option.value === current
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(option.value)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-sm transition-colors',
                    active
                      ? 'bg-[#787D62]/10 font-medium text-[#787D62]'
                      : 'font-medium text-[#555850] hover:bg-[#f7f3ee]',
                  )}
                >
                  <span className="truncate">{option.label}</span>
                  {active && <Check size={14} strokeWidth={2} className="shrink-0" />}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null

    return (
      <div ref={rootRef} className="relative flex min-w-0 w-full flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="crm-field-label">
            {label}
          </label>
        )}

        <select
          ref={ref}
          id={selectId}
          name={name}
          required={required}
          disabled={disabled}
          value={current}
          onChange={(event) => pick(event.target.value)}
          className="sr-only"
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => !disabled && setOpen((v) => !v)}
          className={cn(
            'crm-field cursor-pointer justify-between text-left',
            open && 'border-[#bda27e] shadow-[0_0_0_2px_rgba(189,162,126,0.3)]',
            isPlaceholder && 'text-[#8a8d87]',
            error && 'border-red-500',
            className,
          )}
        >
          <span className="min-w-0 truncate">{display}</span>
          <ChevronDown
            size={16}
            strokeWidth={1.75}
            className={cn('shrink-0 text-[#8a8d87] transition-transform', open && 'rotate-180')}
          />
        </button>

        {typeof document !== 'undefined' && menu ? createPortal(menu, document.body) : null}

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'

export { Select }
