import type { Metadata } from 'next'
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

export const metadata: Metadata = {
  title: 'Lavilet ',
  description: 'Sistema de gestión inmobiliaria',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className={`${satoshi.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster theme="dark" position="top-right" richColors />
      </body>
    </html>
  )
}
