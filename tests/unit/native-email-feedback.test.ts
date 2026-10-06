import { expect, it } from "vitest"
import { nativeEmailFeedback } from "@/lib/auth/native-email-feedback"

it("explains the native test-sender restriction without exposing provider text", () => {
  expect(nativeEmailFeedback({
    code: "email_address_not_authorized",
    status: 403,
    message: "provider detail that must not be copied",
  })).toBe("Email delivery is limited to authorized test accounts during this internal test phase.")
})

it.each([
  null, undefined, "opaque failure", new Error("private provider detail"),
  { code: "unknown" }, { status: 429 },
  { code: "over_email_send_rate_limit", status: 429 },
  { code: "over_request_rate_limit", status: 429 },
])("leaves unrelated and throttling failures to the existing caller", error => {
  expect(nativeEmailFeedback(error)).toBeNull()
})
