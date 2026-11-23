import Link from "next/link"

interface StatsCardProps {
  label: string
  value: number | string
  href?: string
}

export function StatsCard({ label, value, href }: StatsCardProps) {
  const card = (
    <dl className="flex min-w-0 items-center justify-between gap-4 rounded-lg bg-card px-4 py-3 shadow-xs">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="shrink-0 text-xl font-semibold tabular-nums">{value}</dd>
    </dl>
  )
  if (!href) return card
  return (
    <Link
      href={href}
      className="block min-w-0 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring hover:[&>dl]:bg-accent"
    >
      {card}
    </Link>
  )
}
