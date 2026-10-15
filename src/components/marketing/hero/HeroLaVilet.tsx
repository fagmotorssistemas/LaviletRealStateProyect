'use client'

/* eslint-disable @next/next/no-img-element -- Exact pixel layers from referencia.html. */
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react'
import { Italiana, Archivo } from 'next/font/google'
import styles from './HeroLaVilet.module.css'
import { createHeroAnimation } from './heroAnimation'

  /* ============ VALORES AJUSTADOS EN LA DEMO (no cambiar sin revisar con el equipo) ============ */
  const CONFIG = {
    travel: 1.60,                 // scroll extra del hero fijado, en altos de pantalla (160svh)
    baseLine: 0.88,               // altura de la base del edificio y del borde de la vereda, fracción del alto de pantalla
    sceneOffset: 0.04,           // baja la escena un 4% del alto de pantalla sin cambiar el tamaño del edificio
    buildingWidth: 0.99,          // ancho del edificio en pantallas horizontales, fracción del ancho de pantalla
    buildingWidthPortrait: 1.25,  // en pantallas verticales (se recortan un poco los costados)
    topCropMax: 0.06,             // en pantallas muy anchas, cuánto del techo del edificio puede quedar fuera por arriba (0 = nunca)
    skyDrop: 0.12,                // el horizonte del cielo queda 12% del alto de pantalla por debajo del borde de la vereda
    skyZoomStart: 1.40,           // zoom del cielo al inicio del scroll (baja a 1)
    buildingRise: 0,              // desplazamiento inicial del edificio hacia abajo, fracción de su altura (0 = no sube)
    sunsetTint: 0.60,             // tono atardecer sobre el edificio de día
    logoSize: 0.85,               // logo inicial, fracción del tamaño del título final
    sunsetAt: 0.50,               // atardecer completo a este punto del recorrido
    nightAt: 0.95                 // noche completa a este punto del recorrido
  };


const italiana = Italiana({ weight: '400', subsets: ['latin'], variable: '--font-display', display: 'swap' })
const archivo = Archivo({ weight: ['100', '200', '300', '400', '500'], subsets: ['latin'], variable: '--font-body', display: 'swap' })

function letters(ghost: boolean) {
  return 'LA VILET'.split('').map((ch, i) => ch === ' '
    ? <span key={i} className={styles.sp}>{'\u00a0'}</span>
    : <span key={i} data-letter="" data-v={!ghost && i >= 3 ? '1' : undefined} aria-hidden={!ghost ? true : undefined}>{ch}</span>)
}

export function HeroLaVilet() {
  const pinRef = useRef<HTMLDivElement>(null)
  const animationRef = useRef<ReturnType<typeof createHeroAnimation> | null>(null)
  useLayoutEffect(() => {
    if (!pinRef.current) return
    const animation = createHeroAnimation(pinRef.current, styles, CONFIG)
    animationRef.current = animation
    return () => { animation.destroy(); animationRef.current = null }
  }, [])
  useEffect(() => { animationRef.current?.start() }, [])
  return (
<div ref={pinRef} id="inicio" className={`${styles.pin} ${italiana.variable} ${archivo.variable}`} data-part="pin">
  <svg className={styles.navLines} data-part="navLines" aria-hidden="true">
    <path data-part="pH" d="M93.5 79.5 H1672"/>
    <path data-part="pU" d="M1156 70 H1273"/>
  </svg>
  <section className={styles.hero} data-part="hero" aria-label="La Vilet">
    <div className={styles.sky} data-part="sky">
      <img src="/hero/fondo-dia.webp" alt="" fetchPriority="high" />
      <img src="/hero/fondo.webp" alt="" className={styles.sun} style={{ opacity: 0 }} />
      <img src="/hero/fondo-noche.webp" alt="" className={styles.night} style={{ opacity: 0 }} />
    </div>
    <div className={styles.street} data-part="street">
      <img src="/hero/calle-dia.webp" alt="" />
      <img src="/hero/calle.webp" alt="" className={styles.sun} style={{ opacity: 0 }} />
      <img src="/hero/calle-noche.webp" alt="" className={styles.night} style={{ opacity: 0 }} />
    </div>
    <div className={styles.bld} data-part="bld">
      <img src="/hero/edificio.webp" alt="Edificio La Vilet con su plaza comercial" className={styles.day} fetchPriority="high" />
      <span className={styles.tint} aria-hidden="true"></span>
      <img src="/hero/edificio-noche.webp" alt="" className={styles.night} style={{ opacity: 0 }} />
    </div>
    <div className={styles.veil} data-part="veil" aria-hidden="true"></div>

    <div className={styles.comp} data-part="comp">
      <svg data-part="lines" viewBox="0 0 1672 941" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="lavilet-hero-fade" x1="0" y1="79" x2="0" y2="893" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f0a054"/>
            <stop offset=".86" stopColor="#f0a054"/>
            <stop offset="1" stopColor="#f0a054" stopOpacity="0"/>
          </linearGradient>
        </defs>

        <path data-part="pV" d="M93.5 79.5 V893"/>

      </svg>


      <div data-part="blk">
        <svg data-part="lines2" viewBox="0 0 1672 941" fill="none" aria-hidden="true">
          <path data-part="pB" d="M322 230.5 H153.5 A32 32 0 0 0 121.5 262.5 V651"/>
          <path data-part="dB" d="M334 224 L341 231 L334 238 L327 231 Z"/>
          <path data-part="pR" d="M146 522 H288"/>
          <path data-part="dR" d="M295 515.5 L301.5 522 L295 528.5 L288.5 522 Z"/>
        </svg>
        <p data-part="eye">Suites &amp; Apartments</p>
        <h1 data-part="t" aria-label="La Vilet">{letters(false)}</h1>
        <p data-part="claim" aria-label="El arte de vivir bien.">{'El arte de vivir bien.'.split(' ').map((word, i) => <Fragment key={word}>{i > 0 ? ' ' : null}<span className={styles.w} aria-hidden="true"><i>{word}</i></span></Fragment>)}</p>
        <p data-part="sub"><span><i>Residencias y plaza comercial</i></span><span><i>en Puertas del Sol, Cuenca.</i></span></p>
      </div>
      <div data-part="gh" aria-hidden="true">{letters(true)}</div>
      <div data-part="sd" aria-hidden="true"><svg viewBox="0 0 22 12"><path d="M1 1 L11 10 L21 1"/></svg></div>
    </div>
  </section>
</div>
  )
}
