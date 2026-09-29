interface StatsCardProps {
  label: string
  value: number | string
}

export function StatsCard({ label, value }: StatsCardProps) {
  return (
    <dl className="flex min-w-0 items-center justify-between gap-4 rounded-lg bg-card px-4 py-3 shadow-xs">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="shrink-0 text-xl font-semibold tabular-nums">{value}</dd>
    </dl>
  )
}
