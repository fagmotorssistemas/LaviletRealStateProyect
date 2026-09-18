'use client'

import { useRef } from 'react'
import Image from 'next/image'
import { motion, useScroll, useTransform } from 'framer-motion'
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
  const containerRef = useRef<HTMLDivElement>(null)

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start 80%', 'start 20%']
  })

  const lineScaleY = useTransform(scrollYProgress, [0, 1], [0, 1])

  return (
    <motion.div 
      ref={containerRef}
      className="relative z-30 bg-[#efece4] py-20 sm:py-28 lg:py-32 mkt-dark:bg-[#0a0a0a] overflow-visible group"
      initial="idle"
      animate="active"
      whileHover="active"
      whileTap="active"
    >
      <PaperGrain />
      
      {/* Contenedor de la línea vertical decorativa (estilo radar) */}
      <div className="pointer-events-none absolute -top-64 bottom-0 left-[50%] z-20 block w-2.5 overflow-visible sm:w-4 md:left-[64%] lg:-top-80 lg:left-[67%]">
        
        {/* Línea que crece hacia abajo vinculada al scroll */}
        <motion.div 
          style={{ scaleY: lineScaleY }}
          className="absolute inset-0 bg-[#C45C3E]/80 origin-top"
        />

        {/* Círculo superior */}
        <motion.div 
          initial={{ opacity: 0, scale: 0 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: false, margin: "-50px" }}
          transition={{ duration: 0.6, ease: "backOut" }}
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-50"
        >
          <div className="absolute h-16 w-16 sm:h-20 sm:w-20 rounded-full bg-[#C45C3E] animate-ping opacity-80" />
          <div className="relative h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-[#C45C3E] shadow-[0_0_20px_rgba(196,92,62,1)]" />
        </motion.div>
        
        {/* Círculos concéntricos */}
        <motion.div 
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: false, margin: "-100px" }}
          transition={{ duration: 1, delay: 0.3 }}
          className="absolute top-[calc(47%+6cm)] left-1/2 -translate-x-1/2 -translate-y-1/2 md:top-[47%]"
        >
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.1, 1], opacity: [0.9, 0.35, 0.9], transition: { repeat: Infinity, duration: 2.4, ease: "easeInOut", delay: 0 } }
            }}
            className="absolute top-1/2 left-1/2 h-[360px] w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/30 sm:h-[600px] sm:w-[600px] md:h-[900px] md:w-[900px]" 
          />
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.16, 1], opacity: [0.9, 0.3, 0.9], transition: { repeat: Infinity, duration: 2.4, ease: "easeInOut", delay: 0.2 } }
            }}
            className="absolute top-1/2 left-1/2 h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/40 sm:h-[400px] sm:w-[400px] md:h-[600px] md:w-[600px]" 
          />
          <motion.div 
            variants={{
              idle: { scale: 1, opacity: 1 },
              active: { scale: [1, 1.24, 1], opacity: [0.95, 0.25, 0.95], transition: { repeat: Infinity, duration: 2.4, ease: "easeInOut", delay: 0.4 } }
            }}
            className="absolute top-1/2 left-1/2 h-[160px] w-[160px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-[#C45C3E]/50 sm:h-[240px] sm:w-[240px] md:h-[300px] md:w-[300px]" 
          />
        </motion.div>
      </div>

      <div className="relative mx-auto max-w-[1600px] px-5 sm:px-8 lg:px-12">
        <div className="grid gap-16 md:grid-cols-[1fr_1.2fr] lg:grid-cols-[1fr_1.5fr] lg:gap-20 items-center">
          
          {/* Columna Izquierda: Textos */}
          <div className="relative z-30 flex flex-col md:text-right md:items-end">
            <p className="relative z-30 -mx-3 max-w-sm bg-[#efece4] px-3 py-4 text-[14px] leading-relaxed text-[#2B1A18]/70 sm:text-[15px] md:mx-0 md:bg-transparent md:p-0">
              En La Vilet lo cercano es parte del proyecto: el río, el parque lineal y el barrio de Puertas del Sol forman un sitio completo. Su ubicación en esquina crea vida peatonal, activación comercial y una conexión natural.
            </p>
            
            <h2 className="relative z-30 -mx-3 mt-12 bg-[#efece4] px-3 py-3 font-serif text-[clamp(4rem,9vw,8rem)] leading-none tracking-[-0.02em] text-[#72735A] sm:mt-20 md:mx-0 md:bg-transparent md:p-0">
              ubicación
            </h2>
            
            <div className="mt-8 sm:mt-12 flex flex-col sm:flex-row items-start sm:items-center gap-8 md:justify-end">
              <div className="relative z-30 -mx-3 flex flex-col bg-[#efece4] px-3 py-3 md:mx-0 md:bg-transparent md:p-0 md:text-right">
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
          <div className="relative w-full z-10">
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

        <div className="relative mt-20 lg:mt-32 z-30">
          <NearbyAutoCarousel />
        </div>
      </div>
    </motion.div>
  )
}
