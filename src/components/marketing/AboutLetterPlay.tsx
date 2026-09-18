'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'

const PLAY = [
  { ch: 'L', bg: '#C45C3E', row: 0, col: 0, tilt: -11, lane: 0 },
  { ch: 'a', bg: '#BDA27E', row: 0, col: 1, tilt: 8, lane: 0 },
  { ch: 'V', bg: '#72735A', row: 1, col: 0, tilt: 10, lane: 1 },
  { ch: 'i', bg: '#8B8C74', row: 1, col: 1, tilt: -9, lane: 1 },
  { ch: 'l', bg: '#C45C3E', row: 1, col: 2, tilt: 7, lane: 0 },
  { ch: 'ē', bg: '#BDA27E', row: 1, col: 3, tilt: -12, lane: 1 },
  { ch: 't', bg: '#72735A', row: 1, col: 4, tilt: 9, lane: 0 },
] as const

type Phase = 'run' | 'hide' | 'form'

function metrics(width: number) {
  const tile = Math.round(Math.min(56, Math.max(32, width / 11)))
  const gap = Math.max(3, Math.round(tile * 0.08))
  const blockW = 5 * tile + 4 * gap
  return { tile, gap, blockW }
}

function formPos(col: number, row: number, tile: number, gap: number, blockW: number) {
  return {
    x: -blockW / 2 + col * (tile + gap),
    y: row * (tile + gap),
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function AboutLetterPlay() {
  const reduce = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inView = useInView(wrapRef, { amount: 0.25 })
  const [phase, setPhase] = useState<Phase>('hide')
  const [box, setBox] = useState({ w: 900, h: 700 })

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (reduce || !inView) return

    let cancelled = false
    const loop = async () => {
      while (!cancelled) {
        setPhase('run')
        await wait(2800)
        if (cancelled) return
        setPhase('hide')
        await wait(380)
        if (cancelled) return
        setPhase('form')
        await wait(2400)
        if (cancelled) return
        setPhase('hide')
        await wait(420)
      }
    }
    void loop()
    return () => {
      cancelled = true
    }
  }, [inView, reduce])

  const { tile, gap, blockW } = metrics(box.w)
  const travel = Math.max(box.w * 0.72, 280)
  const topY = -box.h / 2 + tile * 0.62
  const bottomY = box.h / 2 - tile * 0.72
  const smileForm = formPos(5, 1, tile, gap, blockW)
  const visiblePhase: Phase = reduce ? 'form' : inView ? phase : 'hide'

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden>
      {PLAY.map((letter, index) => {
        const formed = formPos(letter.col, letter.row, tile, gap, blockW)
        const fromLeft = index % 2 === 0
        const startX = fromLeft ? -travel : travel
        const endX = fromLeft ? travel : -travel
        const runY = letter.lane === 0 ? topY : bottomY

        return (
          <PlayTile
            key={letter.ch + letter.col + letter.row}
            bg={letter.bg}
            phase={visiblePhase}
            size={tile}
            form={{ x: formed.x, y: topY + formed.y }}
            run={{ startX, endX, runY, tilt: letter.tilt, delay: index * 0.16 }}
            hideDelay={index * 0.03}
            formDelay={0.08 + index * 0.06}
          >
            {letter.ch}
          </PlayTile>
        )
      })}
      <PlayTile
        bg="transparent"
        phase={visiblePhase}
        size={tile}
        round
        upright
        form={{ x: smileForm.x, y: topY + smileForm.y }}
        run={{
          startX: -travel,
          endX: travel,
          runY: topY + 8,
          tilt: 0,
          delay: 0.55,
        }}
        hideDelay={0.12}
        formDelay={0.5}
      >
        <SmileFace wink={visiblePhase === 'form' && !reduce} />
      </PlayTile>
    </div>
  )
}

function SmileFace({ wink }: { wink: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-[2rem] w-[2rem] drop-shadow-[0_2px_5px_rgba(196,92,62,0.35)] sm:h-[2.25rem] sm:w-[2.25rem]"
      aria-hidden
    >
      <motion.ellipse
        cx="11"
        cy="12"
        rx="2.7"
        ry="2.7"
        fill="#C45C3E"
        animate={wink ? { ry: [2.7, 2.7, 0.12, 0.12, 2.7] } : { ry: 2.7 }}
        transition={
          wink
            ? {
                duration: 0.9,
                delay: 0.6,
                times: [0, 0.25, 0.42, 0.68, 1],
                ease: 'easeInOut',
              }
            : { duration: 0.15 }
        }
      />
      <circle cx="21" cy="12" r="2.7" fill="#C45C3E" />
      <path
        d="M10 20c2.2 3.2 9.8 3.2 12 0"
        fill="none"
        stroke="#C45C3E"
        strokeWidth="2.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PlayTile({
  bg,
  phase,
  form,
  run,
  hideDelay,
  formDelay,
  size,
  round = false,
  upright = false,
  children,
}: {
  bg: string
  phase: Phase
  form: { x: number; y: number }
  run: { startX: number; endX: number; runY: number; tilt: number; delay: number }
  hideDelay: number
  formDelay: number
  size: number
  round?: boolean
  upright?: boolean
  children: ReactNode
}) {
  const spin = upright ? 0 : undefined
  const face = round ? size : Math.round(size * 0.86)
  return (
    <motion.span
      className={
        round
          ? 'absolute top-1/2 left-1/2 inline-flex items-center justify-center rounded-full'
          : 'absolute top-1/2 left-1/2 inline-flex items-center justify-center font-serif leading-none text-[#F2F2F2]'
      }
      style={{
        backgroundColor: bg,
        width: face,
        height: size,
        fontSize: round ? undefined : size * 0.62,
        marginLeft: -face / 2,
        marginTop: -size / 2,
      }}
      initial={false}
      animate={
        phase === 'form'
          ? { x: form.x, y: form.y, rotate: 0, opacity: 1, scale: 1 }
          : phase === 'run'
            ? {
                x: [run.startX, run.endX],
                y: [run.runY, run.runY - Math.min(10, size * 0.22), run.runY + 6, run.runY - 8, run.runY],
                rotate: upright ? 0 : [run.tilt, -run.tilt, run.tilt, 0],
                opacity: 1,
                scale: 1,
              }
            : { x: run.startX, y: run.runY, rotate: spin ?? run.tilt, opacity: 0, scale: 0.85 }
      }
      transition={
        phase === 'run'
          ? {
              duration: 1.85,
              delay: run.delay,
              ease: [0.22, 0.8, 0.36, 1],
              times: [0, 0.25, 0.5, 0.75, 1],
            }
          : phase === 'form'
            ? {
                type: 'spring',
                stiffness: 320,
                damping: 16,
                mass: 0.7,
                delay: formDelay,
              }
            : { duration: 0.28, delay: hideDelay }
      }
    >
      {children}
    </motion.span>
  )
}
