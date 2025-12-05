import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

export function QuickActions() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Quick Actions</h2>
      <Button className="justify-start gap-2">
        <Plus className="h-4 w-4" />
        New Booking
      </Button>
      <Button variant="outline" className="justify-start gap-2 bg-transparent">
        <Plus className="h-4 w-4" />
        Add artist
      </Button>
    </div>
  )
}
