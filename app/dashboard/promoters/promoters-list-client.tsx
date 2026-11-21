"use client"

import { useState } from "react"
import Link from "next/link"
import { Mail, Pencil, Phone, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { PromoterListItem } from "@/lib/actions/promoters"
import { filterPromoters } from "@/lib/promoter-search"

export function PromotersListClient({ promoters }: { promoters: PromoterListItem[] }) {
  const [query, setQuery] = useState("")
  const shown = filterPromoters(promoters, query)
  const searching = query.trim() !== ""

  return (
    <div className="space-y-4">
      <div className="relative w-full sm:max-w-sm">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search promoters"
          placeholder="Search by name, company, email or phone"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {searching
          ? `${shown.length} of ${promoters.length} ${promoters.length === 1 ? "promoter" : "promoters"}`
          : `${promoters.length} ${promoters.length === 1 ? "promoter" : "promoters"}`}
      </p>
      {shown.length === 0 ? (
        <div className="space-y-3 rounded-lg border px-4 py-8 text-center">
          <p className="text-muted-foreground">No promoters match your search.</p>
          <Button type="button" variant="outline" onClick={() => setQuery("")}>Clear search</Button>
        </div>
      ) : (
        <ul className="grid gap-3" aria-label="Promoters">
          {shown.map((promoter) => (
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
