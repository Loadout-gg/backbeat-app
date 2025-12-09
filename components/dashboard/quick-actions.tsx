import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export function QuickActions() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Quick Actions</h2>
      <Button className="justify-start gap-2" asChild>
        <Link href="/dashboard/events/new">
          <Plus className="h-4 w-4" />
          New Booking
        </Link>
      </Button>
      <Button variant="outline" className="justify-start gap-2 bg-transparent" asChild>
        <Link href="/dashboard/artists/new">
          <Plus className="h-4 w-4" />
          Add artist
        </Link>
      </Button>
    </div>
  )
}
