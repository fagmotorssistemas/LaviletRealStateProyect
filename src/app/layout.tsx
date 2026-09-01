import type { Metadata } from 'next'
import { Bodoni_Moda } from 'next/font/google'
import localFont from 'next/font/local'
import { Toaster } from 'sonner'
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${satoshi.variable} ${bodoni.variable} h-full scroll-smooth antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  )
}
