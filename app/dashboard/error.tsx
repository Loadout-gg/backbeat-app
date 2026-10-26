"use client"

import { Button } from "@/components/ui/button"

export default function DashboardError({ reset }: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <section className="space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Dashboard unavailable</h1>
      <p role="alert">Unable to load workspace data. Please try again.</p>
      <Button onClick={reset}>Try again</Button>
    </section>
  )
}
