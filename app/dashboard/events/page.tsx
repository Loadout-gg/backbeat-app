import Link from "next/link"
import { Plus, MapPin } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { listEvents } from "@/lib/actions/events"

function getStatusBadgeVariant(status: string) {
  switch (status) {
    case "confirmed":
      return "default"
    case "in_progress":
      return "secondary"
    case "cancelled":
      return "destructive"
    default:
      return "outline"
  }
}

function formatStatus(status: string) {
  return status.replace("_", " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function EventsPage() {
  const events = await listEvents()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="text-sm text-muted-foreground">Manage bookings and performances</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/events/new">
            <Plus className="mr-2 h-4 w-4" />
            New event
          </Link>
        </Button>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">No events yet. Create your first event to get started.</p>
            <Button asChild>
              <Link href="/dashboard/events/new">
                <Plus className="mr-2 h-4 w-4" />
                New event
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Card key={event.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-center justify-center w-14 h-14 bg-muted rounded-md text-center">
                    <span className="text-xs uppercase text-muted-foreground">
                      {new Date(event.date).toLocaleDateString("en-US", { month: "short" })}
                    </span>
                    <span className="text-lg font-semibold">{new Date(event.date).getDate()}</span>
                  </div>
                  <div>
                    <h3 className="font-medium">{event.title}</h3>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      {event.artists && <span>{event.artists.name}</span>}
                      {event.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {event.location}
                        </span>
                      )}
                      {event.promoters && <span>{event.promoters.company_name || event.promoters.name}</span>}
                    </div>
                  </div>
                </div>
                <Badge variant={getStatusBadgeVariant(event.status)}>{formatStatus(event.status)}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
