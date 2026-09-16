import type { ReactNode } from 'react'

/** Sombreado de Nosotros que se dispersa, ligero, hacia abajo. */
export function LandingWash({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#e8dcc8_0%,#ead9c4_42%,#efe8dc_100%)] mkt-dark:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(180deg,#cfc3b3_0%,#d4c8b8_48%,#cfc3b3_100%)] mkt-dark:block"
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
