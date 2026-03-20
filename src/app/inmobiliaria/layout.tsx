import { AuthProvider } from '@/contexts/AuthContext'
import { InmobiliariaSidebar } from '@/components/layout/InmobiliariaSidebar'
import { InmobiliariaRouteKey } from '@/components/layout/InmobiliariaRouteKey'

export default function InmobiliariaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <div className="flex h-screen overflow-hidden">
        <InmobiliariaSidebar />
        <div className="flex-1 overflow-y-auto p-4 md:p-8 pt-20 md:pt-8 w-full">
          <div className="max-w-7xl mx-auto h-full">
            <InmobiliariaRouteKey>{children}</InmobiliariaRouteKey>
          </div>
        </div>
      </div>
    </AuthProvider>
  )
}
