import Link from 'next/link'

export function ExploreFloors() {
  return (
    <section className="relative z-20 py-20 lg:py-28" aria-labelledby="explora-plantas">
      <div className="mx-auto max-w-[1400px] px-5 text-center sm:px-8 lg:px-12">
        <p className="text-[11px] font-medium tracking-[0.32em] text-[#8B8C74] uppercase mkt-dark:text-[#BFBFB8]">
          Plantas
        </p>
        <h2
          id="explora-plantas"
          className="mt-6 font-serif text-[clamp(2.15rem,7.4vw,6.35rem)] leading-[0.92] font-bold tracking-[-0.035em] uppercase"
        >
          <span className="block text-[#C45C3E]">Recorre el edificio,</span>
          <span className="mt-[0.08em] block">
            <span className="text-[#BDA27E]">planta </span>
            <span className="text-[#72735A] mkt-dark:text-[#F2F2F2]">por planta</span>
          </span>
        </h2>
        <p className="mx-auto mt-8 max-w-xl text-sm leading-relaxed text-[#72735A]/70 sm:text-base mkt-dark:text-[#F2F2F2]/70">
          Cada planta de LaVilēt junta el habitar, la luz y la terraza en un mismo plano.
          Elige un piso, ábrelo en 360° y entra a cada suite.
        </p>
        <Link
          href="/tour"
          className="mt-8 inline-flex items-center text-[13px] font-semibold tracking-[0.16em] text-[#72735A] uppercase transition-colors hover:text-[#8B8C74] mkt-dark:text-[#F2F2F2] mkt-dark:hover:text-[#BFBFB8]"
        >
          Abrir showroom
          <span className="ml-2 inline-block h-px w-5 bg-current" />
        </Link>
      </div>
    </section>
  )
}
