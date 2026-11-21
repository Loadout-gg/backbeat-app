import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { RetryButton } from "@/components/retry-button"
import { listPromoterDirectory, type PromoterListItem } from "@/lib/actions/promoters"
import { PromotersListClient } from "./promoters-list-client"

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
        <PromotersListClient promoters={promoters} />
      )}
    </div>
  )
}
