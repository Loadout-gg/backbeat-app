import { redirect } from "next/navigation"

export default function HomePage() {
  // Root page redirects to login (proxy will redirect to dashboard if authenticated)
  redirect("/auth/login")
}
