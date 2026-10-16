'use client'

import ReactDOM from 'react-dom'

export function HeroMediaPreload() {
  ReactDOM.preload('/hero/fondo-dia.webp', { as: 'image', fetchPriority: 'high' })
  ReactDOM.preload('/hero/edificio-dia.webp', { as: 'image', fetchPriority: 'high' })
  ReactDOM.preload('/hero/calle-dia.webp', { as: 'image', fetchPriority: 'high' })

  return null
}
