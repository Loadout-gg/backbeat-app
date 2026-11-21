import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { Mail, Pencil, Phone, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RetryButton } from "@/components/retry-button"
import { listPromoterDirectory, type PromoterListItem } from "@/lib/actions/promoters"

export default async function PromotersPage() {
  let promoters: PromoterListItem[] = []
  let loadError = false
  try {
    promoters = await listPromoterDirectory()
  } catch (error) {
    unstable_rethrow(error)
    loadError = true
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Promoters</h1>
          <p className="text-sm text-muted-foreground">The people you book events with</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/promoters/new">
            <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
            Add promoter
          </Link>
        </Button>
      </div>

      {loadError ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">Unable to load promoters. Please refresh and try again.</p>
          <RetryButton label="Retry loading promoters" />
        </div>
      ) : promoters.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="mb-4 text-muted-foreground">No promoters yet. Add the first one to link it to your events.</p>
            <Button asChild>
              <Link href="/dashboard/promoters/new">
                <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
                Add promoter
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3" aria-label="Promoters">
          {promoters.map((promoter) => (
            <li key={promoter.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 [overflow-wrap:anywhere]">
                  <div className="min-w-0">
                    <h2 className="font-medium">{promoter.name}</h2>
                    {promoter.company_name && <p className="text-sm text-muted-foreground">{promoter.company_name}</p>}
                    {(promoter.email || promoter.phone) && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {promoter.email && (
                          <span className="flex items-center gap-1">
                            <Mail aria-hidden="true" className="h-3 w-3 shrink-0" />
                            {promoter.email}
                          </span>
                        )}
                        {promoter.phone && (
                          <span className="flex items-center gap-1">
                            <Phone aria-hidden="true" className="h-3 w-3 shrink-0" />
                            {promoter.phone}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/dashboard/promoters/${promoter.id}/edit`} aria-label={`Edit ${promoter.name}`}>
                      <Pencil aria-hidden="true" className="mr-2 h-4 w-4" />
                      Edit
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
