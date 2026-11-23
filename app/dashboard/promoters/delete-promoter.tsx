"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { deletePromoter } from "@/lib/actions/promoters"

const UNCONFIRMED = "Unable to confirm whether the promoter was deleted. Check the promoter list before retrying."

export function DeletePromoter({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const inFlight = useRef(false)
  const [confirming, setConfirming] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const questionId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Keyboard flow: opening moves focus to Cancel (the safe choice); Cancel returns it to the trigger.
  const focusAfterRender = useRef<"cancel" | "trigger" | null>(null)
  useEffect(() => {
    const target = focusAfterRender.current
    focusAfterRender.current = null
    if (target === "cancel") cancelRef.current?.focus()
    if (target === "trigger") triggerRef.current?.focus()
  }, [confirming])

  async function handleDelete() {
    if (inFlight.current) return
    inFlight.current = true
    setIsDeleting(true)
    setError(null)
    try {
      const result = await deletePromoter(id)
      if (result.success) {
        router.push("/dashboard/promoters")
        return
      }
      setError(result.error)
    } catch {
      setError(UNCONFIRMED)
    }
    inFlight.current = false
    setIsDeleting(false)
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Delete promoter</CardTitle>
        <CardDescription>
          This cannot be undone. Events linked to this promoter are kept, without a promoter.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {confirming ? (
          <div role="group" aria-labelledby={questionId} className="space-y-3">
            <p id={questionId} className="text-sm [overflow-wrap:anywhere]">Delete {name}?</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button ref={cancelRef} type="button" variant="outline" onClick={() => { focusAfterRender.current = "trigger"; setConfirming(false) }} disabled={isDeleting}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button ref={triggerRef} type="button" variant="outline" onClick={() => { setError(null); focusAfterRender.current = "cancel"; setConfirming(true) }}>
            <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Delete promoter
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
