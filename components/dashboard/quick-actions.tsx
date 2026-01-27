import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export function QuickActions() {
  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <h2 className="text-base font-semibold">Quick Actions</h2>
      <div className="flex flex-col gap-2">
        <Button className="w-full justify-start gap-2" asChild>
          <Link href="/dashboard/events/new">
            <Plus className="h-4 w-4" />
            New Booking
          </Link>
        </Button>
        <Button variant="outline" className="w-full justify-start gap-2" asChild>
          <Link href="/dashboard/artists/new">
            <Plus className="h-4 w-4" />
            Add artist
          </Link>
        </Button>
      </div>
    </div>
  )
}
