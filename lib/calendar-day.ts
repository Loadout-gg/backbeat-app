/** Return a date-only day in the explicit calendar zone, independent of the host zone. */
export function calendarDay(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)!.value
  return `${value("year")}-${value("month")}-${value("day")}`
}

/** Server-side "today" in the configured calendar zone (UTC when unset), shared by booking pages. */
export function configuredCalendarDay(now: Date = new Date()): string {
  return calendarDay(now, process.env.BACKBEAT_CALENDAR_TIME_ZONE ?? "UTC")
}
