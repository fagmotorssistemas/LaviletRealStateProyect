import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ACCESS_PENDING_PATH, isAccessPending } from '@/lib/auth/accessPending'
import { canAccessPath, homePathForRole, normalizeCrmPaths } from '@/lib/inmobiliaria/roleAccess'
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
    if (response !== supabaseResponse) {
      supabaseResponse.cookies.getAll().forEach((cookie) => {
        response.cookies.set(cookie)
      })
    }
    applyVisitorCookie(request, response)
    return response
  }

  if (!user && !isPublicPath && pathname !== ACCESS_PENDING_PATH) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname.startsWith('/tour') ? '?next=/tour' : ''
    return finish(NextResponse.redirect(url))
  }

  let role: string | null = null
  let crmPaths: string[] | null = null
  const accessPending = Boolean(user && isAccessPending(user))
  if (user) {
    crmPaths = (() => {
      const paths = normalizeCrmPaths(user.app_metadata?.crm_paths)
      return paths.length > 0 ? paths : null
    })()
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

  if (user && accessPending) {
    if (
      pathname.startsWith('/login') ||
      pathname.startsWith('/register') ||
      pathname.startsWith('/inmobiliaria') ||
      pathname === '/cuenta'
    ) {
      const url = request.nextUrl.clone()
      url.pathname = ACCESS_PENDING_PATH
      url.search = ''
      return finish(NextResponse.redirect(url))
    }
    if (pathname === ACCESS_PENDING_PATH) {
      return finish(supabaseResponse)
    }
  }

  if (user && !accessPending && pathname === ACCESS_PENDING_PATH) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role, crmPaths)
    url.search = ''
    return finish(NextResponse.redirect(url))
  }

  if (user && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role, crmPaths)
    url.search = ''
    url.hash = ''
    return finish(NextResponse.redirect(url))
  }

  if (user && pathname.startsWith('/inmobiliaria') && !canAccessPath(role, pathname, crmPaths)) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role, crmPaths)
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
