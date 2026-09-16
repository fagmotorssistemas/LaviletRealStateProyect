'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

const FOOTER_LETTERS = [
  { ch: 'L', bg: '#C45C3E', row: 0, tilt: -11 },
  { ch: 'a', bg: '#BDA27E', row: 0, tilt: 8 },
  { ch: 'V', bg: '#72735A', row: 1, tilt: 10 },
  { ch: 'i', bg: '#8B8C74', row: 1, tilt: -9 },
  { ch: 'l', bg: '#C45C3E', row: 1, tilt: 7 },
  { ch: 'ē', bg: '#BDA27E', row: 1, tilt: -12 },
  { ch: 't', bg: '#72735A', row: 1, tilt: 9 },
] as const

const COUNT = FOOTER_LETTERS.length

export function FooterWordmark() {
  const reduce = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const inView = useInView(wrapRef, { amount: 0.12, margin: '0px 0px -8% 0px' })
  const [fromY, setFromY] = useState(0)
  const [hasEntered, setHasEntered] = useState(false)

  useLayoutEffect(() => {
    if (!wrapRef.current) return
    const top = wrapRef.current.getBoundingClientRect().top
    setFromY(Math.round(Math.max(top, 0) + window.innerHeight * 0.35))
    if (inView) setHasEntered(true)
  }, [inView])

  const topRow = FOOTER_LETTERS.filter((letter) => letter.row === 0)
  const bottomRow = FOOTER_LETTERS.filter((letter) => letter.row === 1)

  return (
    <div ref={wrapRef}>
      <p className="sr-only">La Vilēt</p>
      <div className="flex gap-1" aria-hidden>
        {topRow.map((letter, i) => (
          <FooterTile
            key={letter.ch}
            letter={letter}
            index={i}
            fromY={fromY}
            inView={inView}
            hasEntered={hasEntered}
            reduce={Boolean(reduce)}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {bottomRow.map((letter, i) => (
          <FooterTile
            key={letter.ch}
            letter={letter}
            index={i + topRow.length}
            fromY={fromY}
            inView={inView}
            hasEntered={hasEntered}
            reduce={Boolean(reduce)}
          />
        ))}
      </div>
    </div>
  )
}

function FooterTile({
  letter,
  index,
  fromY,
  inView,
  hasEntered,
  reduce,
}: {
  letter: (typeof FOOTER_LETTERS)[number]
  index: number
  fromY: number
  inView: boolean
  hasEntered: boolean
  reduce: boolean
}) {
  const land = reduce || inView
  const delay = land ? index * 0.07 : (COUNT - 1 - index) * 0.05

  return (
    <motion.span
      initial={false}
      animate={
        land
          ? { y: 0, opacity: 1, rotate: 0 }
          : { y: -fromY, opacity: 0, rotate: letter.tilt }
      }
      transition={
        reduce || !hasEntered
          ? { duration: 0 }
          : {
              y: {
                type: 'spring',
                stiffness: land ? 78 : 110,
                damping: land ? 13 : 20,
                mass: 1,
                delay,
              },
              rotate: {
                type: 'spring',
                stiffness: 70,
                damping: 14,
                delay,
              },
              opacity: land
                ? { duration: 0, delay }
                : { duration: 0.18, delay: delay + 0.32, ease: 'easeIn' },
            }
      }
      className="relative z-40 inline-flex h-[2.7rem] w-[2.35rem] items-center justify-center font-serif text-[1.85rem] leading-none text-[#F2F2F2] will-change-transform sm:h-[3.35rem] sm:w-[2.9rem] sm:text-[2.35rem]"
      style={{ backgroundColor: letter.bg, pointerEvents: land ? 'auto' : 'none' }}
    >
      {letter.ch}
    </motion.span>
  )
}

export function AboutTitleMark({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const reduce = useReducedMotion()
  const wrapRef = useRef<HTMLHeadingElement>(null)
  const inView = useInView(wrapRef, { amount: 0.35, once: true })
  const topRow = FOOTER_LETTERS.filter((letter) => letter.row === 0)
  const bottomRow = FOOTER_LETTERS.filter((letter) => letter.row === 1)
  const tileClass =
    size === 'lg'
      ? 'h-[3.6rem] w-[2.85rem] text-[2.35rem] sm:h-[4.8rem] sm:w-[3.8rem] sm:text-[3.2rem] lg:h-[5.8rem] lg:w-[4.6rem] lg:text-[3.9rem]'
      : 'h-[2.7rem] w-[2.15rem] text-[1.7rem] sm:h-[3.4rem] sm:w-[2.7rem] sm:text-[2.2rem] lg:h-[4rem] lg:w-[3.2rem] lg:text-[2.7rem]'

  return (
    <h2 ref={wrapRef} className="mt-3">
      <span className="sr-only">La Vilēt</span>
      <span className="block" aria-hidden>
        <span className="flex gap-1 sm:gap-1.5">
          {topRow.map((letter, i) => (
            <TitleTile
              key={letter.ch}
              letter={letter}
              index={i}
              from={-1}
              inView={reduce || inView}
              className={tileClass}
              reduce={Boolean(reduce)}
            />
          ))}
        </span>
        <span className="mt-1 flex gap-1 sm:gap-1.5">
          {bottomRow.map((letter, i) => (
            <TitleTile
              key={letter.ch}
              letter={letter}
              index={i + topRow.length}
              from={1}
              inView={reduce || inView}
              className={tileClass}
              reduce={Boolean(reduce)}
            />
          ))}
        </span>
      </span>
    </h2>
  )
}

function TitleTile({
  letter,
  index,
  from,
  inView,
  className,
  reduce,
}: {
  letter: (typeof FOOTER_LETTERS)[number]
  index: number
  from: number
  inView: boolean
  className: string
  reduce: boolean
}) {
  return (
    <motion.span
      initial={false}
      animate={
        inView
          ? { x: 0, opacity: 1, rotate: 0 }
          : { x: from * 72, opacity: 0, rotate: letter.tilt }
      }
      transition={
        reduce
          ? { duration: 0 }
          : {
              type: 'spring',
              stiffness: 86,
              damping: 14,
              mass: 0.9,
              delay: inView ? index * 0.045 : 0,
            }
      }
      className={cn(
        'inline-flex items-center justify-center font-serif leading-none text-[#F2F2F2]',
        className,
      )}
      style={{ backgroundColor: letter.bg }}
    >
      {letter.ch}
    </motion.span>
  )
}
