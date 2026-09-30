"use client"

import { useRef, useState } from "react"
import { useAuthClientReady } from "@/lib/auth/use-client-ready"
import { ConfirmationCode } from "@/components/auth/confirmation-code"
import { X } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { readPendingSignup, pendingSignupKey } from "@/lib/auth/pending-signup"
import SignupPage from "@/app/auth/signup/page"

export default function SignupSuccessPage() {
  const ready = useAuthClientReady()
  return ready ? <ConfirmationFlow /> : <p role="status" className="p-6 text-sm text-muted-foreground">Loading confirmation...</p>
}

function ConfirmationFlow() {
  const router = useRouter()
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(() => readPendingSignup()?.email || "")
  const [recoveryEmail, setRecoveryEmail] = useState("")
  const [notice, setNotice] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [token, setToken] = useState("")

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (lock.current) return
    if (!/^\d{6}$/.test(token)) { setError("Enter the six-digit code from your email."); return }
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await createClient().auth.verifyOtp({ email, token, type: "email" })
      if (error) { setError(error.status === 429 ? "Too many attempts. Please wait, then try again." : "The code is incorrect or expired. Try again or request a new code."); return }
      if (!data.session) { setError("Could not establish your session. Try confirming again."); return }
      try { sessionStorage.removeItem(pendingSignupKey) } catch { /* A verified session must not depend on draft storage. */ }
      setToken("")
      router.push("/onboarding")
    } catch {
      setError("Could not confirm your email. Check your connection and try again.")
    } finally { lock.current = false; setBusy(false) }
  }

  async function resendCode() {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    setNotice("")
    try {
      const { error } = await createClient().auth.resend({ type: "signup", email })
      if (error) { setError(error.status === 429 ? "Please wait before requesting another code, then try again." : "Could not resend the code. Please try again."); return }
      setNotice("A new code has been requested. Check your inbox.")
    } catch { setError("Could not resend the code. Check your connection and try again.") }
    finally { lock.current = false; setBusy(false) }
  }

  return <>
    <SignupPage />
    <Dialog open onOpenChange={(open) => { if (!open && !lock.current) { setToken(""); router.push("/auth/signup") } }}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto pt-12 sm:max-w-md" showCloseButton={false} onOpenAutoFocus={(event) => {
        event.preventDefault()
        document.getElementById(email ? "confirmation-code" : "registration-email")?.focus()
      }}>
        <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2" disabled={busy} aria-label="Close confirmation" onClick={() => { setToken(""); router.push("/auth/signup") }}><X aria-hidden="true" /></Button>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle>Check your email inbox</DialogTitle>
          <DialogDescription>{email ? <>To continue, confirm your email. Enter the code we sent to <span className="block break-all font-medium text-foreground">{email}</span></> : "Enter the email you used to register to resume confirmation. You can use your existing code or request a new one."}</DialogDescription>
        </DialogHeader>
        {!email ? <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault()
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) { setError("Enter a valid email address."); return }
          setEmail(recoveryEmail.trim())
          setError(null)
        }}>
          <Label htmlFor="registration-email">Registration email</Label>
          <Input id="registration-email" type="email" autoComplete="email" required value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} />
          {error && <p id="confirmation-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit">Continue confirmation</Button>
        </form> : <form onSubmit={confirm} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="confirmation-code">Confirmation code</Label>
            <ConfirmationCode value={token} onChange={setToken} disabled={busy} invalid={!!error} />
          </div>
          {error && <p id="confirmation-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy}>{busy ? "Please wait..." : "Confirm"}</Button>
          <Button type="button" variant="link" disabled={busy} onClick={resendCode}>Resend code</Button>
          {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
        </form>}
      </DialogContent>
    </Dialog>
  </>
}
