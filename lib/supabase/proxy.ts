import { getSupabaseEnvironment } from "./environment"

import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

export async function updateSession(request: NextRequest) {
  // GoTrue fetches this static template before sending email. It must not depend
  // on an Auth session or call back into the Auth service that requested it.
  if (request.nextUrl.pathname === "/auth/signup-confirmation.html") {
    return NextResponse.next({ request })
  }

  const { url, key } = getSupabaseEnvironment()
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          const previousCookies = supabaseResponse.cookies.getAll()
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          previousCookies.forEach((cookie) => supabaseResponse.cookies.set(cookie))
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  // IMPORTANT: Do not run any code between createServerClient and supabase.auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  function redirectWithCookies(pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  const pathname = request.nextUrl.pathname

  // Public routes that don't require authentication
  const publicRoutes = ["/auth/login", "/auth/signup", "/auth/signup-success", "/auth/error"]
  const isPublicRoute = publicRoutes.some((route) => pathname.startsWith(route))

  // Not authenticated
  if (!user) {
    if (isPublicRoute || pathname === "/") {
      return supabaseResponse
    }
    // Redirect to login, retaining any session-cookie clearing.
    return redirectWithCookies("/auth/login")
  }

  // Authenticated - check onboarding status
  const { data: onboardingStatus, error: onboardingError } = await supabase
    .from("onboarding_status")
    .select("completed, workspace_id")
    .eq("user_id", user.id)
    .single()

  // A deleted workspace may leave completed=true with a null selection.
  // This is routing only: actions and RLS still enforce active membership.
  const onboardingCompleted =
    !onboardingError &&
    onboardingStatus?.completed === true &&
    typeof onboardingStatus.workspace_id === "string" &&
    onboardingStatus.workspace_id.length > 0

  // User not onboarded
  if (!onboardingCompleted) {
    if (pathname.startsWith("/onboarding")) {
      return supabaseResponse
    }
    if (!isPublicRoute) {
      return redirectWithCookies("/onboarding")
    }
  }

  // User onboarded
  if (onboardingCompleted) {
    // Redirect away from onboarding
    if (pathname.startsWith("/onboarding")) {
      return redirectWithCookies("/dashboard")
    }
    // Redirect authenticated users away from auth pages and home
    if (isPublicRoute || pathname === "/") {
      return redirectWithCookies("/dashboard")
    }
  }

  return supabaseResponse
}
