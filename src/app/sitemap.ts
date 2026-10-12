import type { MetadataRoute } from 'next'

const origin = 'https://www.lavilett.com'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    '/inicio',
    '/proyectos',
    '/nosotros',
    '/proceso',
    '/ubicanos',
    '/contacto',
    '/simulador',
    '/tour',
    '/privacidad',
  ].map((pathname) => ({ url: `${origin}${pathname}` }))
}
