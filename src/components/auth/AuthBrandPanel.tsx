'use client'

import { useState, useEffect, useCallback } from 'react'

const PHRASES = [
  { top: 'Gestiona', bottom: 'tus proyectos' },
  { top: 'Impulsa', bottom: 'tus ventas' },
  { top: 'Controla', bottom: 'tu inventario' },
  { top: 'Conecta', bottom: 'con tus leads' },
  { top: 'Organiza', bottom: 'tu agenda' },
  { top: 'Cierra', bottom: 'más contratos' },
]

const FLOATING_SHAPES = [
  { size: 280, x: '70%', y: '15%', delay: 0, duration: 18 },
  { size: 200, x: '15%', y: '60%', delay: 4, duration: 22 },
  { size: 150, x: '80%', y: '75%', delay: 8, duration: 16 },
  { size: 100, x: '40%', y: '20%', delay: 2, duration: 20 },
  { size: 120, x: '25%', y: '85%', delay: 6, duration: 14 },
]

export function AuthBrandPanel() {
  const [currentPhrase, setCurrentPhrase] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  const cyclePhrase = useCallback(() => {
    setIsVisible(false)
    setTimeout(() => {
      setCurrentPhrase((prev) => (prev + 1) % PHRASES.length)
      setIsVisible(true)
    }, 600)
  }, [])

  useEffect(() => {
    const interval = setInterval(cyclePhrase, 3500)
    return () => clearInterval(interval)
  }, [cyclePhrase])

  const phrase = PHRASES[currentPhrase]

  return (
    <div className="hidden lg:flex lg:flex-1 relative overflow-hidden">
      {/* Animated mesh gradient background */}
      <div className="absolute inset-0 auth-gradient-bg" />

      {/* Floating blurred shapes */}
      {FLOATING_SHAPES.map((shape, i) => (
        <div
          key={i}
          className="absolute rounded-full auth-float-shape"
          style={{
            width: shape.size,
            height: shape.size,
            left: shape.x,
            top: shape.y,
            background: i % 2 === 0
              ? 'radial-gradient(circle, rgba(189,162,126,0.15) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%)',
            animationDelay: `${shape.delay}s`,
            animationDuration: `${shape.duration}s`,
          }}
        />
      ))}

      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(189,162,126,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(189,162,126,0.5) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Diagonal accent line */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute w-[1px] h-[200%] bg-gradient-to-b from-transparent via-[#BDA27E]/20 to-transparent -rotate-[25deg] auth-line-sweep" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
        <div />

        {/* Dynamic text area */}
        <div className="flex-1 flex flex-col justify-center -mt-12">
          <div className="space-y-4">
            <p className="text-xs font-medium tracking-[0.3em] uppercase text-[#BDA27E]/70">
              Lavilet
            </p>

            <div className="min-h-[140px] flex flex-col justify-center">
              <h2
                className="text-5xl xl:text-6xl font-bold leading-[1.1] auth-phrase-transition"
                style={{ opacity: isVisible ? 1 : 0, transform: isVisible ? 'translateY(0)' : 'translateY(16px)' }}
              >
                <span className="text-[#BDA27E] italic">{phrase.top}</span>
                <br />
                <span className="text-white/90">{phrase.bottom}</span>
              </h2>
            </div>

            <div className="flex items-center gap-3 mt-2">
              <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-[#BDA27E]/60 to-transparent" />
              <p className="text-white/40 text-sm">
                inmobiliarios
              </p>
            </div>
          </div>

          {/* Phrase indicators */}
          <div className="flex gap-2 mt-10">
            {PHRASES.map((_, i) => (
              <div
                key={i}
                className="h-1 rounded-full transition-all duration-500"
                style={{
                  width: i === currentPhrase ? 32 : 8,
                  backgroundColor: i === currentPhrase ? '#BDA27E' : 'rgba(255,255,255,0.15)',
                }}
              />
            ))}
          </div>
        </div>

        {/* Bottom tagline */}
        <div className="flex items-center justify-between">
          <p className="text-white/30 text-xs max-w-[240px]">
            Inventario, leads, showroom, agenda y contratos en un solo lugar.
          </p>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full auth-dot-pulse"
                style={{
                  backgroundColor: 'rgba(189,162,126,0.4)',
                  animationDelay: `${i * 0.4}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
