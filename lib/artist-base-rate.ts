// Display the artist's standard rate, without converting or changing stored values.
export function formatArtistBaseRate(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return "N/A"
  const formattedAmount = amount.toLocaleString("en-US")
  if (!currency?.trim()) return `${formattedAmount} (currency unavailable)`

  switch (currency) {
    case "GBP":
    case "£":
      return `£${formattedAmount}`
    case "EUR":
    case "€":
      return `€${formattedAmount}`
    case "USD":
    case "$":
      return `$${formattedAmount}`
    default:
      return `${currency} ${formattedAmount}`
  }
}
