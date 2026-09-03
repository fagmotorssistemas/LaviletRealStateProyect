import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { canAccessPath, homePathForRole } from '@/lib/inmobiliaria/roleAccess'
import { createAdminClient } from '@/lib/supabase/admin'

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
    pathname === '/' || pathname.startsWith('/login') || pathname.startsWith('/register')

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname.startsWith('/tour') ? '?next=/tour' : ''
    return NextResponse.redirect(url)
  }

  let role: string | null = null
  if (user) {
    try {
      const { data: profile } = await createAdminClient()
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      role = profile?.role ?? 'visitante'
    } catch {
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      role = profile?.role ?? 'visitante'
    }
  }

  if (user && (pathname.startsWith('/login') || pathname.startsWith('/register'))) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role)
    url.search = ''
    url.hash = ''
    return NextResponse.redirect(url)
  }

  if (user && pathname.startsWith('/inmobiliaria') && !canAccessPath(role, pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = homePathForRole(role)
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|fonts|api|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|webm)$).*)',
  ],
}
