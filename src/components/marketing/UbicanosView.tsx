'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { SITE } from '@/lib/marketing/site'
import type { MarketingProjectLocation } from '@/lib/marketing/projectLocationTypes'
import { NearbyAutoCarousel } from './NearbyAutoCarousel'

function addressLines(project: MarketingProjectLocation | null): string[] {
  if (project?.address) {
    const parts = project.address
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length >= 2) return parts.slice(0, 4)
    return [
      project.address,
      [project.city, project.country].filter(Boolean).join(', ') || SITE.city,
    ]
  }
  return ['Ricardo Darquea Granda y Elena Landívar', 'Cuenca, Ecuador']
}

function PaperGrain() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-40 mix-blend-multiply"
      style={{
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(114,115,90,0.04) 0px, rgba(114,115,90,0.04) 1px, transparent 1px, transparent 3px), repeating-linear-gradient(90deg, rgba(114,115,90,0.03) 0px, rgba(114,115,90,0.03) 1px, transparent 1px, transparent 4px)',
      }}
    />
  )
}

export function UbicanosView({ project }: { project: MarketingProjectLocation | null }) {
  const lines = addressLines(project)

  return (
    <motion.div 
      className="relative z-30 bg-[#efece4] py-20 sm:py-28 lg:py-32 mkt-dark:bg-[#0a0a0a] overflow-visible group"
      initial="idle"
      whileHover="active"
      whileTap="active"
    >
      <PaperGrain />
      
      {/* Línea vertical decorativa (estilo radar) */}
      <div className="pointer-events-none absolute -top-64 lg:-top-80 bottom-0 left-[50%] md:left-[64%] lg:left-[67%] w-3 sm:w-4 bg-[#C45C3E]/40 z-50 hidden md:block overflow-visible">
        {/* Círculo superior */}
        <div className="absolute top-0 left-1/2 h-12 w-12 sm:h-16 sm:w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#C45C3E] animate-pulse shadow-[0_0_20px_rgba(196,92,62,0.6)]" />
        
        {/* Círculos concéntricos */}
        <div className="absolute top-[47%] left-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.05, 1], opacity: [1, 0.6, 1], transition: { repeat: Infinity, duration: 2, ease: "easeInOut", delay: 0 } }
            }}
            className="absolute top-1/2 left-1/2 h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/30" 
          />
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.1, 1], opacity: [1, 0.5, 1], transition: { repeat: Infinity, duration: 2, ease: "easeInOut", delay: 0.2 } }
            }}
            className="absolute top-1/2 left-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/40" 
          />
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.15, 1], opacity: [1, 0.4, 1], transition: { repeat: Infinity, duration: 2, ease: "easeInOut", delay: 0.4 } }
            }}
            className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/50" 
          />
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-16 md:grid-cols-[1fr_1.2fr] lg:grid-cols-[1fr_1.5fr] lg:gap-20 items-center">
          
          {/* Columna Izquierda: Textos */}
          <div className="flex flex-col md:text-right md:items-end">
            <p className="max-w-sm text-[14px] sm:text-[15px] leading-relaxed text-[#2B1A18]/70">
              En La Vilet lo cercano es parte del proyecto: el río, el parque lineal y el barrio de Puertas del Sol forman un sitio completo. Su ubicación en esquina crea vida peatonal, activación comercial y una conexión natural.
            </p>
            
            <h2 className="mt-12 sm:mt-20 font-serif text-[clamp(4rem,9vw,8rem)] leading-none text-[#72735A] tracking-[-0.02em]">
              ubicación
            </h2>
            
            <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center gap-8 md:justify-end">
              <div className="flex flex-col md:text-right">
                <p className="font-display text-[clamp(1.2rem,2vw,1.6rem)] leading-[1.2] font-semibold text-[#C45C3E] uppercase">
                  RICARDO DARQUEA GRANDA<br/>
                  & ELENA LANDÍVAR,<br/>
                  <span className="text-[#2B1A18]">PUERTAS DEL SOL, CUENCA</span>
                </p>
              </div>
              
              <a
                href={project?.mapsUrl || SITE.location.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group relative flex h-24 w-24 sm:h-28 sm:w-28 shrink-0 items-center justify-center rounded-full border border-[#C45C3E] text-center transition-all hover:bg-[#C45C3E] z-40 bg-[#efece4] hover:shadow-lg"
              >
                <span className="text-[9px] sm:text-[10px] font-semibold tracking-widest text-[#C45C3E] transition-colors group-hover:text-[#efece4]">
                  ABRIR EN<br/>GOOGLE<br/>MAPS
                </span>
              </a>
            </div>
          </div>

          {/* Columna Derecha: Mapa Ilustrado */}
          <div className="relative w-full z-20">
            <div className="relative w-full overflow-hidden shadow-2xl ring-1 ring-[#2B1A18]/10 bg-[#efece4]">
              <Image
                src="https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/ubicacion_lavilet.png"
                alt="Mapa ilustrado de ubicación La Vilet"
                width={1200}
                height={1200}
                className="w-full h-auto object-contain scale-[1.02]"
                sizes="(max-width: 1024px) 100vw, 60vw"
                unoptimized
              />
            </div>
          </div>
          
        </div>

        <div className="mt-20 lg:mt-32">
          <NearbyAutoCarousel />
        </div>
      </div>
    </motion.div>
  )
}
