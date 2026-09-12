'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { InvestmentConfigurator } from '@/components/financing/InvestmentConfigurator'
import { MisEscenariosView } from '@/components/financing/MisEscenariosView'
import { Spinner } from '@/components/ui/Spinner'
import { isShowroomIdentified } from '@/lib/tour/showroomIdentity'

type UnitOption = {
  id: string
  unit_number: string
  bedrooms: number | null
  published_commercial_price: number | null
}

export function ClientSimulatorPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialUnit = searchParams.get('unidad')?.trim() || ''
  const openSaved = searchParams.get('tab') === 'escenarios' || searchParams.get('guardados') === '1'

  const [units, setUnits] = useState<UnitOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedUnit, setSelectedUnit] = useState(initialUnit)
  const [identified, setIdentified] = useState(false)
  const [showSaved, setShowSaved] = useState(openSaved)

  useEffect(() => {
    setIdentified(isShowroomIdentified())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const response = await fetch('/api/financing/units')
        const json = (await response.json()) as { units?: UnitOption[]; error?: string }
        if (!response.ok) throw new Error(json.error || 'No se pudieron cargar los departamentos')
        if (!cancelled) setUnits(json.units ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const next = new URLSearchParams()
    if (selectedUnit) next.set('unidad', selectedUnit)
    if (showSaved && identified) next.set('guardados', '1')
    const qs = next.toString()
    const current = searchParams.toString()
    if (qs === current) return
    router.replace(qs ? `/simulador?${qs}` : '/simulador', { scroll: false })
  }, [selectedUnit, showSaved, identified, router, searchParams])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return units
    return units.filter((unit) => unit.unit_number.toLowerCase().includes(q))
  }, [units, query])

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="space-y-2">
        <h1 className="font-serif text-3xl leading-tight text-[#1f1a14] sm:text-4xl">
          Simulador de inversión
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-[#6b645c]">
          Elija un departamento, ajuste alquiler y gastos, y vea el retorno estimado de la inversión.
        </p>
      </header>

      {identified ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#BDA27E]/35 bg-[#BDA27E]/10 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-[#4a433c]">
            Ya tiene su celular registrado. Puede simular y guardar sus cálculos.
          </p>
          <button
            type="button"
            onClick={() => setShowSaved((value) => !value)}
            className="shrink-0 rounded-full bg-[#1a2744] px-4 py-2 text-[11px] font-semibold tracking-[0.12em] text-white uppercase"
          >
            {showSaved ? 'Ocultar guardados' : 'Ver guardados'}
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#e4ddd3] bg-white px-4 py-3 text-sm leading-relaxed text-[#6b645c]">
          Puede explorar libremente.{' '}
          <Link href="/tour" className="font-medium text-[#1a2744] underline-offset-2 hover:underline">
            Deje su celular en el showroom
          </Link>{' '}
          para guardar favoritos y acceder a financiamiento.
        </div>
      )}

      {showSaved && identified ? (
        <section className="space-y-3">
          <h2 className="font-serif text-xl text-[#1f1a14]">Cálculos guardados</h2>
          <MisEscenariosView embedded />
        </section>
      ) : null}

      {selectedUnit ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setSelectedUnit('')}
            className="text-sm font-medium text-[#6b645c] hover:text-[#1a2744]"
          >
            ← Elegir otro departamento
          </button>
          <InvestmentConfigurator
            unitParam={selectedUnit}
            onOpenSaved={
              identified
                ? () => {
                    setShowSaved(true)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                : undefined
            }
          />
        </div>
      ) : loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <p className="text-sm text-rose-700">{error}</p>
      ) : (
        <div className="space-y-4">
          <label className="block max-w-md space-y-1.5">
            <span className="text-sm font-medium text-[#4a433c]">Buscar departamento</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ej. 001, 204…"
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#BDA27E]"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => setSelectedUnit(unit.unit_number)}
                className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 text-left transition-colors hover:border-[#BDA27E]/50"
              >
                <p className="text-lg font-semibold text-[#1f1a14]">Depto. {unit.unit_number}</p>
                <p className="text-xs text-[#8a8176]">
                  {unit.bedrooms != null ? `${unit.bedrooms} dormitorios` : 'Ver simulación'}
                </p>
              </button>
            ))}
          </div>
          {filtered.length === 0 ? (
            <p className="text-sm text-[#6b645c]">No encontramos ese número.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
