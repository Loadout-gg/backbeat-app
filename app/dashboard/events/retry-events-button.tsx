"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export function RetryEventsButton() {
  const router = useRouter()
  return (
    <Button type="button" variant="outline" onClick={() => router.refresh()}>
      Retry loading events
    </Button>
  )
}
