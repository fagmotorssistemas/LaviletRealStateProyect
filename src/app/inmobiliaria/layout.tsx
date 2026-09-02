import { AuthProvider } from '@/contexts/AuthContext'
import { InmobiliariaSidebar } from '@/components/layout/InmobiliariaSidebar'
import { InmobiliariaTopbar } from '@/components/layout/InmobiliariaTopbar'
import { InmobiliariaRouteKey } from '@/components/layout/InmobiliariaRouteKey'

export default function InmobiliariaLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AuthProvider>
      <div className="crm-app relative flex h-[100dvh] overflow-hidden">
        <InmobiliariaSidebar />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <InmobiliariaTopbar />
          <div className="crm-app-canvas min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-8 pt-[calc(3.5rem+2rem)] sm:px-8 md:pt-8 lg:px-12">
            <InmobiliariaRouteKey>{children}</InmobiliariaRouteKey>
          </div>
        </div>
      </div>
    </AuthProvider>
  )
}
