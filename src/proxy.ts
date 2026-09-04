import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessPath, homePathForRole, knownRole } from '@/lib/inmobiliaria/roleAccess'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { applyVisitorCookie } from '@/lib/tour/visitorCookie'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isPublicPath =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/tour') ||
    pathname.startsWith('/privacidad') ||
    pathname.startsWith('/seguimiento')

  const finish = (response: NextResponse) => {
    applyVisitorCookie(request, response)
    return response
  }

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname.startsWith('/tour') ? '?next=/tour' : ''
    return finish(NextResponse.redirect(url))
  }

  let role: string | null = null
  if (user) {
    try {
      const admin = tryCreateAdminClient()
      const reader = admin ?? supabase
      const { data: profile } = await reader.from('profiles').select('role').eq('id', user.id).maybeSingle()
      role = profile?.role ?? null
    } catch {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      role = profile?.role ?? null
    }
  }

  if (user && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role)
    url.search = ''
    url.hash = ''
    return finish(NextResponse.redirect(url))
  }

  if (user && pathname.startsWith('/inmobiliaria') && knownRole(role) && !canAccessPath(role, pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role)
    url.search = ''
    return finish(NextResponse.redirect(url))
  }

  return finish(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|fonts|api|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|webm)$).*)',
  ],
}
