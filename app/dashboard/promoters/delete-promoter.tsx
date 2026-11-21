"use client"

import { useRef, useState } from "react"
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
          <div className="space-y-3">
            <p className="text-sm">Delete {name}?</p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Yes, delete"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={isDeleting}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => { setError(null); setConfirming(true) }}>
            <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
            Delete promoter
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
