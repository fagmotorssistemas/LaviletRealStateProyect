import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from 'sonner'
import { AuthProvider } from '@/contexts/AuthContext'
import { CookieBanner } from '@/components/marketing/CookieBanner'
import { MetaPixel } from '@/components/marketing/MetaPixel'
import './globals.css'

const satoshi = localFont({
  src: [
    { path: '../../public/fonts/Satoshi/Satoshi-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Satoshi/Satoshi-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/Satoshi/Satoshi-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
})

// Keep display fonts local so production builds do not depend on Google Fonts.
const cormorant = localFont({
  src: '../../public/fonts/CormorantGaramond/CormorantGaramond-Variable.ttf',
  weight: '300 700',
  style: 'normal',
  variable: '--font-cormorant',
  display: 'swap',
})

const bodoni = localFont({
  src: '../../public/fonts/BodoniModa/BodoniModa-Variable.ttf',
  weight: '400 900',
  style: 'normal',
  display: 'swap',
  variable: '--font-bodoni',
})

export const metadata: Metadata = {
  title: {
    default: 'Lavilet',
    template: '%s | Lavilet',
  },
  description: 'Proyectos inmobiliarios y gestión Lavilet',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className={`${satoshi.variable} ${cormorant.variable} ${bodoni.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <AuthProvider>
          {children}
          <CookieBanner />
          <MetaPixel />
          <Toaster theme="dark" position="top-center" richColors className="!z-[200]" />
        </AuthProvider>
      </body>
    </html>
  )
}
