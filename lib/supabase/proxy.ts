import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

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
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
      auth: {
        storageKey: "bb-auth-token",
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  )

  // IMPORTANT: Do not run code between createServerClient and supabase.auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public routes that don't require authentication
  const publicRoutes = ["/auth/login", "/auth/signup", "/auth/signup-success", "/auth/error"]
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // If user is not authenticated
  if (!user) {
    // Allow access to public routes
    if (isPublicRoute || pathname === "/") {
      return supabaseResponse
    }
    // Redirect to login for protected routes
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  // User is authenticated - check onboarding status
  const { data: onboardingStatus } = await supabase
    .from("onboarding_status")
    .select("completed")
    .eq("user_id", user.id)
    .single()

  const onboardingCompleted = onboardingStatus?.completed ?? false

  // If onboarding not completed
  if (!onboardingCompleted) {
    // Allow access to onboarding page
    if (pathname.startsWith("/onboarding")) {
      return supabaseResponse
    }
    // Redirect to onboarding from any other protected route
    if (!isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = "/onboarding"
      return NextResponse.redirect(url)
    }
  }

  // If onboarding is completed
  if (onboardingCompleted) {
    // Redirect away from onboarding page
    if (pathname.startsWith("/onboarding")) {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
    // Redirect authenticated users from auth pages to dashboard
    if (isPublicRoute || pathname === "/") {
      const url = request.nextUrl.clone()
      url.pathname = "/dashboard"
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
