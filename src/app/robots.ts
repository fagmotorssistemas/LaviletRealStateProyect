import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/inmobiliaria/',
        '/cuenta',
        '/login',
        '/register',
        '/acceso-pendiente',
        '/departamento/',
        '/seguimiento',
        '/tour/unidad/',
      ],
    },
    sitemap: 'https://www.lavilett.com/sitemap.xml',
  }
}
