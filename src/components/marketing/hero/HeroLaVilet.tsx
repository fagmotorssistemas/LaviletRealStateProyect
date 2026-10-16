'use client'

/* eslint-disable @next/next/no-img-element -- Pixel-aligned layers from referencia.html. */
import { useEffect, useLayoutEffect, useRef } from 'react'
import localFont from 'next/font/local'
import { createHeroAnimation } from './heroAnimation'
import styles from './HeroLaVilet.module.css'

  /* ============ VALORES APROBADOS EN LA DEMO — no cambiar sin revisar con el equipo ============
     travel   scroll extra del hero fijado, en % del alto de pantalla (240 = 240svh)
     rise     desplazamiento inicial del edificio hacia abajo, % de su altura (0 = no sube)
     sky      zoom extra del cielo al inicio, % (40 = scale 1.40 → 1)
     logo     tamaño del logo inicial, % del título final
     logoX/Y  posición del logo inicial (% de pantalla)        txtX/Y  posición del bloque de texto final (% de pantalla)
     bgY/X/Z  posición y zoom mínimo del fondo (cielo y ciudad)  stY/X   posición de la calle y vereda
     size     tamaño del edificio, %                              x / y   posición del edificio (% de pantalla)
     tint     tono atardecer por código sobre el edificio (0: ya no hace falta, el edificio de tarde es una imagen real)
     sunsetAt / nightAt   % del recorrido donde el atardecer y la noche están completos
     carSize / carY / carSpan   tamaño, altura y tramo de scroll del carro (menos tramo = pasa más rápido)
     walkSize / walkSpan        tamaño y tramo de scroll del peatón                                              */
  const state = Object.freeze({ travel: 240, rise: 0, sky: 40, logo: 85, logoX: 0, logoY: 0, txtX: 0, txtY: 0, bgY: 3, bgX: 0, bgZ: 100, stY: 11, stX: 0, size: 120, x: 0, y: -8, tint: 0, sunsetAt: 50, nightAt: 95, carSize: 100, carY: 0, carSpan: 20, walkSpan: 25, walkSize: 120 });

// Keep the hero on the same local families as the app layout: Google Fonts
// responses can otherwise make Turbopack builds fail intermittently.
const italiana = localFont({
  src: '../../../../public/fonts/Italiana/Italiana-Regular.ttf',
  weight: '400',
  variable: '--font-display',
  display: 'swap',
})
const archivo = localFont({
  src: '../../../../public/fonts/Archivo/Archivo-Variable.woff2',
  weight: '100 500',
  variable: '--font-body',
  display: 'swap',
})

export function HeroLaVilet() {
  const pinRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<ReturnType<typeof createHeroAnimation> | null>(null)
  useLayoutEffect(() => {
    if (!pinRef.current) return
    const animation = createHeroAnimation(pinRef.current, styles, state)
    animationRef.current = animation
    return () => { animation.destroy(); animationRef.current = null }
  }, [])
  useEffect(() => { animationRef.current?.start() }, [])
  return (
<div ref={pinRef} id="inicio" className={`${styles.pin} ${italiana.variable} ${archivo.variable}`} data-part="pin">
  <section className={styles['hero']} data-part="hero" aria-label="La Vilet">
    <div className={styles['bg-inner']} data-part="bgInner">
      <img data-part="imgBg" src="/hero/fondo-dia.webp" alt="" fetchPriority="high" decoding="async" />
      <img data-part="imgBgS" src="/hero/fondo-tarde.webp" alt="" style={{ opacity: 0 }} decoding="async" />
      <img data-part="imgBgN" src="/hero/fondo-noche.webp" alt="" style={{ opacity: 0 }} decoding="async" loading="lazy" fetchPriority="low" />
    </div>
    <div className={styles['ground']} data-part="ground">
      <img data-part="imgGround" src="/hero/calle-dia.webp" alt="" fetchPriority="high" decoding="async" />
      <img data-part="imgGroundS" src="/hero/calle-tarde.webp" alt="" style={{ opacity: 0 }} decoding="async" />
      <img data-part="imgGroundN" src="/hero/calle-noche.webp" alt="" style={{ opacity: 0 }} decoding="async" loading="lazy" fetchPriority="low" />
    </div>
    <div className={styles['bld']} data-part="bld">
      <img data-part="imgBld" src="/hero/edificio-dia.webp" alt="Edificio La Vilet con su plaza comercial" fetchPriority="high" decoding="async" />
      <span className={styles['bld-tint']} aria-hidden="true"></span>
      <img className={styles['night']} data-part="imgBldS" src="/hero/edificio-tarde.webp" alt="" style={{ opacity: 0 }} decoding="async" />
      <img className={styles['night']} data-part="imgBldN" src="/hero/edificio-noche.webp" alt="" style={{ opacity: 0 }} decoding="async" loading="lazy" fetchPriority="low" />
      {/* the afternoon rooftop people (couple on the left tower and couple on the roof terrace): they come with the afternoon and leave at night */}
      <img className={styles['night']} data-part="imgBldX" src="/hero/personas-tarde.webp" alt="" style={{ opacity: 0 }} decoding="async" />
      {/* the person on the roof terrace at night */}
      <img className={styles['night']} data-part="imgBldY" src="/hero/personas-noche.webp" alt="" style={{ opacity: 0 }} decoding="async" loading="lazy" fetchPriority="low" />
      <div className={styles['walker']} data-part="walker">
        <span className={styles['shadow']}></span>
        <img src="/hero/peaton-a.webp" alt="" decoding="async" fetchPriority="low" />
        <img src="/hero/peaton-p.webp" alt="" decoding="async" style={{ opacity: 0 }} fetchPriority="low" />
        <img src="/hero/peaton-b.webp" alt="" decoding="async" style={{ opacity: 0 }} fetchPriority="low" />
      </div>
    </div>
    <div className={styles['car']} data-part="car" aria-hidden="true">
      <span className={styles['shadow']}></span>
      <span className={styles['beam']}></span>
      <span className={styles['trail']}></span>
      <img className={styles['refl']} src="/hero/carro.webp" alt="" fetchPriority="low" />
      <img className={styles['body']} src="/hero/carro.webp" alt="" fetchPriority="low" />
    </div>
    <div className={styles['veil']} data-part="veil" aria-hidden="true"></div>

    <div className={styles['comp']} data-part="comp">
      <svg data-part="lines" viewBox="0 0 1672 941" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="lavilet-hero-fade" x1="0" y1="79" x2="0" y2="893" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f0a054"/>
            <stop offset=".86" stopColor="#f0a054"/>
            <stop offset="1" stopColor="#f0a054" stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path data-part="pH" d="M93.5 79.5 H1672"/>
        <path data-part="pV" d="M93.5 79.5 V893"/>
        <path data-part="pU" d="M1156 70 H1273"/>
      </svg>


      <div data-part="blk">
        <svg data-part="lines2" viewBox="0 0 1672 941" fill="none" aria-hidden="true">
          <path data-part="pB" d="M322 230.5 H153.5 A32 32 0 0 0 121.5 262.5 V651"/>
          <path data-part="dB" d="M334 224 L341 231 L334 238 L327 231 Z"/>
          <path data-part="pR" d="M146 522 H288"/>
          <path data-part="dR" d="M295 515.5 L301.5 522 L295 528.5 L288.5 522 Z"/>
        </svg>
        <p data-part="eye">Suites &amp; Apartments</p>
        <h1 data-part="t" aria-label="La Vilet"></h1>
        <p data-part="claim" aria-label="El arte de vivir bien."></p>
        <p data-part="sub"><span><i>Residencias y plaza comercial</i></span><span><i>en Puertas del Sol, Cuenca.</i></span></p>
      </div>
      <div data-part="gh" aria-hidden="true"></div>
      <div data-part="sd" aria-hidden="true"><svg viewBox="0 0 22 12"><path d="M1 1 L11 10 L21 1"/></svg></div>
    </div>
  </section>
</div>
  )
}
