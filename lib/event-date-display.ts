import { z } from 'zod'
const dateOnly = z.string().date()
const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

export function eventDateParts(value: string): { month: string; day: string } {
  if (!dateOnly.safeParse(value).success) return { month: '?', day: '?' }
  const [year, monthNumber, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, monthNumber - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return { month: month.format(date), day: String(day) }
}
