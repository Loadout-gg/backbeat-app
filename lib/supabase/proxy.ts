import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  const supabaseResponse = NextResponse.next({
    request: {
      headers: new Headers(request.headers),
    },
  })

  const forwardSupabaseCookies = (response: NextResponse) => {
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  // IMPORTANT: do not run code between createServerClient and supabase.auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  const publicRoutes = ["/auth/login", "/auth/signup", "/auth/signup-success", "/auth/error"]
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  if (!user) {
    if (isPublicRoute || pathname === "/") {
      return supabaseResponse
    }
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return forwardSupabaseCookies(NextResponse.redirect(url))
  }

  const { data: onboardingStatus } = await supabase
    .from("onboarding_status")
    .select("completed")
    .eq("user_id", user.id)
    .single()

  const onboardingCompleted = onboardingStatus?.completed ?? false

  if (!onboardingCompleted) {
    if (pathname.startsWith("/onboarding")) {
      return supabaseResponse
    }
    if (!isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = "/onboarding"
      return forwardSupabaseCookies(NextResponse.redirect(url))
    }
  }

  if (onboardingCompleted) {
    if (pathname.startsWith("/onboarding")) {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return forwardSupabaseCookies(NextResponse.redirect(url))
    }
    if (isPublicRoute || pathname === "/") {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return forwardSupabaseCookies(NextResponse.redirect(url))
    }
  }

  return supabaseResponse
}
