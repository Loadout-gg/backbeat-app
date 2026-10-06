"use client"

import type React from "react"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BackbeatLogoFull } from "@/components/backbeat-logo"
import { getCurrentUser, updateProfile, createWorkspace } from "@/lib/actions/workspace"
import { User, Building2, ArrowRight, Check } from "lucide-react"

export default function OnboardingPage() {
  const { push } = useRouter()
  const [step, setStep] = useState(0)
  const [fullName, setFullName] = useState("")
  const [workspaceName, setWorkspaceName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const [loadAttempt, setLoadAttempt] = useState(0)
  useEffect(() => {
    let active = true
    getCurrentUser().then((current) => {
      if (!active) return
      if (!current?.user) { push("/auth/login"); return }
      if (current.onboardingStatus?.completed && current.workspace) { push("/dashboard"); return }
      const profile = current.profile
      if (!profile) throw new Error("Profile unavailable")
      setFullName(profile?.full_name || "")
      setStep(profile?.first_name?.trim() && profile?.last_name?.trim() ? 2 : 1)
    }).catch(() => { if (active) setError("Could not load your profile. Please try again.") })
    return () => { active = false }
  }, [loadAttempt, push])

  const handleStepOne = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setError(null)
    setIsLoading(true)

    try {
      await updateProfile(fullName)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsLoading(false)
    }
  }

  const handleStepTwo = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) return
    setError(null)
    setIsLoading(true)

    try {
      const result = await createWorkspace(workspaceName)
      if (result.success) {
        push("/dashboard")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-6">
          <div className="flex justify-center">
            <BackbeatLogoFull />
          </div>

          {step === 0 && (error ? <div className="grid gap-4">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button onClick={() => { setError(null); setLoadAttempt((attempt) => attempt + 1) }}>Try again</Button>
          </div> : <p role="status" className="text-center text-sm text-muted-foreground">Loading your profile...</p>)}
          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {step > 1 ? <Check className="h-4 w-4" /> : "1"}
            </div>
            <div className={`h-0.5 w-12 ${step > 1 ? "bg-primary" : "bg-muted"}`} />
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full ${
                step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              2
            </div>
          </div>

          {step === 1 && (
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl">Welcome to Backbeat</CardTitle>
                <CardDescription>Let&apos;s start by setting up your profile</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStepOne}>
                  <div className="flex flex-col gap-6">
                    <div className="grid gap-2">
                      <Label htmlFor="fullName">Full Name</Label>
                      <Input
                        id="fullName"
                        type="text"
                        placeholder="John Smith"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                      />
                    </div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? (
                        "Saving..."
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Building2 className="h-6 w-6 text-primary" />
                </div>
                <CardTitle className="text-2xl">Create your workspace</CardTitle>
                <CardDescription>A workspace is where you&apos;ll manage your artists and bookings</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStepTwo}>
                  <div className="flex flex-col gap-6">
                    <div className="grid gap-2">
                      <Label htmlFor="workspaceName">Workspace Name</Label>
                      <Input
                        id="workspaceName"
                        type="text"
                        placeholder="My Agency"
                        required
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">This is typically your agency or company name</p>
                    </div>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    <Button type="submit" className="w-full" disabled={isLoading}>
                      {isLoading ? "Creating workspace..." : "Create workspace"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
