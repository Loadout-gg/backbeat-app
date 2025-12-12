interface StatsCardProps {
  label: string
  value: number | string
}

export function StatsCard({ label, value }: StatsCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-6">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold">{value}</span>
    </div>
  )
}
