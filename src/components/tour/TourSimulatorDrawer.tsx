'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Calculator, ChevronLeft, X } from 'lucide-react'
import { InvestmentConfigurator } from '@/components/financing/InvestmentConfigurator'
import { MisEscenariosView } from '@/components/financing/MisEscenariosView'
import { isShowroomIdentified } from '@/lib/tour/showroomIdentity'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'
import './tour-viewer.css'

type TourSimulatorDrawerProps = {
  open: boolean
  onClose: () => void
  /** Unidad preferida (seleccionada en plano / ficha). */
  unitNumber: string | null
  units: TourUnitSummary[]
  onSelectUnit?: (unit: TourUnitSummary) => void
  contained?: boolean
}

/** Panel lateral del simulador (mismo patrón que la ficha técnica). */
export function TourSimulatorDrawer({
  open,
  onClose,
  unitNumber,
  units,
  onSelectUnit,
  contained = false,
}: TourSimulatorDrawerProps) {
  const reduceMotion = useReducedMotion()
  const [showSaved, setShowSaved] = useState(false)
  const [identified, setIdentified] = useState(false)
  const [picking, setPicking] = useState(false)
  const [localUnit, setLocalUnit] = useState(unitNumber?.trim() || '')

  const sortedUnits = useMemo(
    () =>
      [...units].sort((a, b) =>
        a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
      ),
    [units],
  )

  useEffect(() => {
    if (!open) {
      setShowSaved(false)
      setPicking(false)
      return
    }
    setIdentified(isShowroomIdentified())
    const next = unitNumber?.trim() || ''
    setLocalUnit(next)
    setPicking(!next && sortedUnits.length > 0)
  }, [open, unitNumber, sortedUnits.length])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const unitParam = localUnit.trim()
  const pickUnit = (unit: TourUnitSummary) => {
    setLocalUnit(unit.unit_number)
    setPicking(false)
    setShowSaved(false)
    onSelectUnit?.(unit)
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Cerrar simulador"
            className={cn(
              'z-[60] bg-black/25',
              contained ? 'absolute inset-0' : 'fixed inset-0',
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            onClick={onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Simulador de inversión"
            className={cn(
              'z-[70] flex flex-col overflow-hidden rounded-2xl bg-[#f7f3ee] shadow-[0_12px_40px_rgba(15,23,42,0.22)]',
              'w-[min(100%-1.25rem,28rem)]',
              contained
                ? cn(
                    'absolute left-3 sm:left-4',
                    'top-3 bottom-3 max-h-[calc(100%-1.5rem)] sm:top-4 sm:bottom-4',
                  )
                : cn(
                    'fixed left-3 sm:left-5',
                    'top-3 bottom-3 max-h-[calc(100dvh-1.5rem)]',
                    'sm:top-5 sm:bottom-5 sm:max-h-[calc(100dvh-2.5rem)]',
                    '[@media(max-height:520px)]:left-[max(0.5rem,env(safe-area-inset-left))]',
                    '[@media(max-height:520px)]:top-[max(0.5rem,env(safe-area-inset-top))]',
                    '[@media(max-height:520px)]:bottom-[max(0.5rem,env(safe-area-inset-bottom))]',
                    '[@media(max-height:520px)]:w-[min(22rem,calc(100vw-1rem))]',
                  ),
            )}
            initial={reduceMotion ? false : { x: -28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { x: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#2B1A18]/10 bg-white px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Calculator size={15} strokeWidth={1.75} className="shrink-0 text-[#1a2744]" />
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold tracking-[0.14em] text-[#1a2744] uppercase">
                    Simulador
                  </p>
                  <p className="truncate text-[11px] text-[#8a8176]">
                    {unitParam ? `Unidad ${unitParam}` : 'Elija una unidad'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {unitParam && sortedUnits.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(true)
                      setShowSaved(false)
                    }}
                    className="rounded-lg px-2 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#1a2744] uppercase hover:bg-[#f4f4ef]"
                  >
                    Cambiar
                  </button>
                ) : null}
                {identified && unitParam && !picking ? (
                  <button
                    type="button"
                    onClick={() => setShowSaved((value) => !value)}
                    className="rounded-lg px-2 py-1.5 text-[10px] font-semibold tracking-[0.1em] text-[#1a2744] uppercase hover:bg-[#f4f4ef]"
                  >
                    {showSaved ? 'Calcular' : 'Guardados'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1.5 text-[#6b645c] hover:bg-[#f4f4ef] hover:text-[#1a2744]"
                  aria-label="Cerrar"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
            </div>

            <div className="tour-ficha-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
              {picking || !unitParam ? (
                <div className="space-y-3">
                  {unitParam ? (
                    <button
                      type="button"
                      onClick={() => setPicking(false)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium tracking-[0.1em] text-[#6b645c] uppercase hover:text-[#1a2744]"
                    >
                      <ChevronLeft size={14} />
                      Volver al cálculo
                    </button>
                  ) : null}
                  <p className="text-sm text-[#6b645c]">
                    {sortedUnits.length > 0
                      ? 'Elija el departamento a simular:'
                      : 'No hay unidades disponibles para simular en esta tipología.'}
                  </p>
                  <ul className="grid grid-cols-2 gap-2">
                    {sortedUnits.map((unit) => (
                      <li key={unit.id}>
                        <button
                          type="button"
                          onClick={() => pickUnit(unit)}
                          className={cn(
                            'flex w-full flex-col rounded-xl border bg-white px-3 py-3 text-left transition-colors',
                            unit.unit_number === unitParam
                              ? 'border-[#1a2744] ring-1 ring-[#1a2744]/20'
                              : 'border-[#e4ddd3] hover:border-[#BDA27E]/60',
                          )}
                        >
                          <span className="text-base font-semibold text-[#1f1a14]">
                            {unit.unit_number}
                          </span>
                          <span className="text-[11px] text-[#8a8176]">
                            {unit.floor ? `Piso ${unit.floor}` : 'Ver simulación'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : showSaved && identified ? (
                <div className="space-y-3">
                  <h2 className="font-serif text-xl text-[#1f1a14]">Cálculos guardados</h2>
                  <MisEscenariosView embedded />
                </div>
              ) : (
                <InvestmentConfigurator
                  unitParam={unitParam}
                  stacked
                  onOpenSaved={
                    identified
                      ? () => {
                          setShowSaved(true)
                        }
                      : undefined
                  }
                />
              )}
            </div>
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}
