"use client"

import type React from "react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useAuthClientReady } from "@/lib/auth/use-client-ready"
import { readPendingSignup } from "@/lib/auth/pending-signup"
import { BackbeatLogoFull } from "@/components/backbeat-logo"

export default function SignupPage() {
  const ready = useAuthClientReady()
  return ready ? <SignupForm /> : <p role="status" className="p-6 text-sm text-muted-foreground">Loading registration...</p>
}

function SignupForm() {
  const [firstName, setFirstName] = useState(() => readPendingSignup()?.firstName || "")
  const [lastName, setLastName] = useState(() => readPendingSignup()?.lastName || "")
  const [email, setEmail] = useState(() => readPendingSignup()?.email || "")
  const [password, setPassword] = useState("")
  const [repeatPassword, setRepeatPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const [pendingEmail, setPendingEmail] = useState(() => readPendingSignup()?.email || "")

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    if (pendingEmail && pendingEmail.toLowerCase() === email.trim().toLowerCase()) {
      setPassword(""); setRepeatPassword(""); router.push("/auth/signup-success"); return
    }
    const supabase = createClient()
    setIsLoading(true)
    setError(null)

    const requiredErrors: Record<string, string> = {}
    if (!firstName.trim()) requiredErrors["first-name"] = "Enter your name."
    else if ([...firstName.trim()].length > 100 || /\p{Cc}/u.test(firstName.trim())) requiredErrors["first-name"] = "Use 100 characters or fewer, without control characters."
    if (!lastName.trim()) requiredErrors["last-name"] = "Enter your surname."
    else if ([...lastName.trim()].length > 100 || /\p{Cc}/u.test(lastName.trim())) requiredErrors["last-name"] = "Use 100 characters or fewer, without control characters."
    if (!email.trim()) requiredErrors.email = "Enter your email."
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) requiredErrors.email = "Enter a valid email address."
    if (!password) requiredErrors.password = "Create a password."
    if (!repeatPassword) requiredErrors["repeat-password"] = "Confirm your password."
    setFieldErrors(requiredErrors)
    if (Object.keys(requiredErrors).length) {
      document.getElementById(Object.keys(requiredErrors)[0])?.focus()
      setIsLoading(false)
      return
    }

    if (password !== repeatPassword) {
      setFieldErrors({ "repeat-password": "Passwords don’t match." })
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setFieldErrors({ password: "Use at least 8 characters." })
      setIsLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: firstName.trim(), last_name: lastName.trim(), full_name: `${firstName.trim()} ${lastName.trim()}` },
          emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL || `${window.location.origin}/onboarding`,
        },
      })
      if (error) throw error
      try { sessionStorage.setItem("backbeat.pending-signup", JSON.stringify({ email: email.trim(), firstName: firstName.trim(), lastName: lastName.trim() })) }
      catch { /* Confirmation offers email recovery when tab storage is unavailable. */ }
      setPendingEmail(email.trim())
      setPassword("")
      setRepeatPassword("")
      router.push("/auth/signup-success")
    } catch (error: unknown) {
      const failure = error as { code?: string; status?: number }
      setError(failure?.code === "user_already_exists" || failure?.code === "email_exists"
        ? "An account with this email already exists. Log in or use another email."
        : failure?.status === 429
          ? "Please wait before trying again. You can also resume email confirmation if you have already registered."
          : "Could not create your account. Check your connection and try again. If you already received a code, continue confirmation.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <div className="flex justify-center">
            <BackbeatLogoFull />
          </div>
          <Card>
            <CardHeader>
              <CardTitle><h1 className="text-2xl">Create an account</h1></CardTitle>
              <CardDescription>Enter your details to get started with Backbeat</CardDescription>
            </CardHeader>
            <CardContent>
              <form noValidate onSubmit={handleSignUp}>
                <div className="flex flex-col gap-6">
                  <div className="grid gap-2">
                    <Label htmlFor="first-name">Name</Label>
                    <Input id="first-name" aria-invalid={!!fieldErrors["first-name"]} aria-describedby={fieldErrors["first-name"] ? "first-name-error" : undefined} autoComplete="given-name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    {fieldErrors["first-name"] && <p id="first-name-error" className="text-sm text-destructive">{fieldErrors["first-name"]}</p>}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="last-name">Surname</Label>
                    <Input id="last-name" aria-invalid={!!fieldErrors["last-name"]} aria-describedby={fieldErrors["last-name"] ? "last-name-error" : undefined} autoComplete="family-name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    {fieldErrors["last-name"] && <p id="last-name-error" className="text-sm text-destructive">{fieldErrors["last-name"]}</p>}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email" aria-invalid={!!fieldErrors["email"]} aria-describedby={fieldErrors["email"] ? "email-error" : undefined}
                      type="email"
                      placeholder="you@example.com"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {fieldErrors["email"] && <p id="email-error" className="text-sm text-destructive">{fieldErrors["email"]}</p>}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password" aria-invalid={!!fieldErrors["password"]} aria-describedby={fieldErrors["password"] ? "password-error" : "password-hint"}
                      type="password"
                      autoComplete="new-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <p id="password-hint" className="text-xs text-muted-foreground">Must be at least 8 characters long.</p>
                    {fieldErrors["password"] && <p id="password-error" className="text-sm text-destructive">{fieldErrors["password"]}</p>}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="repeat-password">Confirm Password</Label>
                    <Input
                      id="repeat-password" aria-invalid={!!fieldErrors["repeat-password"]} aria-describedby={fieldErrors["repeat-password"] ? "repeat-password-error" : undefined}
                      type="password"
                      autoComplete="new-password"
                      required
                      value={repeatPassword}
                      onChange={(e) => setRepeatPassword(e.target.value)}
                    />
                    {fieldErrors["repeat-password"] && <p id="repeat-password-error" className="text-sm text-destructive">{fieldErrors["repeat-password"]}</p>}
                  </div>
                  {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  {pendingEmail && <div className="grid gap-2 text-sm">
                    <p className="break-words text-muted-foreground">Your registration is awaiting email confirmation.</p>
                    <Button type="button" variant="outline" onClick={() => router.push("/auth/signup-success")}>Continue confirmation</Button>
                  </div>}
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Creating account..." : "Create account"}
                  </Button>
                </div>
                {!pendingEmail && <p className="mt-4 text-center text-sm text-muted-foreground">
                  Already have a code? <Link href="/auth/signup-success" className="text-foreground underline underline-offset-4">Continue confirmation</Link>
                </p>}
                <div className="mt-4 text-center text-sm">
                  Already have an account?{" "}
                  <Link href="/auth/login" className="underline underline-offset-4">
                    Login
                  </Link>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
