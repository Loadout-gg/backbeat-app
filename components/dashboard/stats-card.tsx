interface StatsCardProps {
  label: string
  value: number | string
}

export function StatsCard({ label, value }: StatsCardProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold">{value}</span>
    </div>
  )
}
