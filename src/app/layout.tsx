import type { Metadata, Viewport } from 'next'
import { Bodoni_Moda, Cormorant_Garamond } from 'next/font/google'
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

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-cormorant',
  display: 'swap',
})

const bodoni = Bodoni_Moda({
  subsets: ['latin', 'latin-ext'],
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
