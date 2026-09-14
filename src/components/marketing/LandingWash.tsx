import type { ReactNode } from 'react'

/** Sombreado de Nosotros que se dispersa, ligero, hacia abajo. */
export function LandingWash({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,#e4e4de_0%,#e4e4de_16%,#f0f0ec_38%,#f2f2f2_58%,#f2f2f2_100%)] mkt-dark:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(180deg,#72735A_0%,#72735A_100%)] mkt-dark:block"
      />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
