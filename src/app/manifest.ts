import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'La Vilet',
    short_name: 'La Vilet',
    description: 'Showroom La Vilet',
    start_url: '/tour',
    scope: '/',
    // Pantalla completa; standalone queda en display_override para quien no la soporte.
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#14110e',
    theme_color: '#14110e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }
}
