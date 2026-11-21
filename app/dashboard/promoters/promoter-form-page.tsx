"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { PromoterForm } from "@/components/dashboard/promoter-form"
import type { PromoterDetail } from "@/lib/actions/promoters"
import { DeletePromoter } from "./delete-promoter"

export function PromoterFormPage({ promoter }: { promoter?: PromoterDetail }) {
  const router = useRouter()
  const backToList = () => router.push("/dashboard/promoters")
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/promoters" aria-label="Back to promoters">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{promoter ? "Edit promoter" : "Add promoter"}</h1>
          <p className="text-sm text-muted-foreground">
            {promoter ? "Update this promoter's contact details." : "A promoter is a contact person; the company is optional."}
          </p>
        </div>
      </div>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Promoter details</CardTitle>
          <CardDescription>Only the name is required.</CardDescription>
        </CardHeader>
        <CardContent>
          <PromoterForm promoter={promoter} onSaved={backToList} onCancel={backToList} />
        </CardContent>
      </Card>
      {promoter && <DeletePromoter id={promoter.id} name={promoter.name} />}
    </div>
  )
}
