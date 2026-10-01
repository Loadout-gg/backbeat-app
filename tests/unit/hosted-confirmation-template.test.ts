import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect, it } from "vitest"
import { hostedConfirmationPatch } from "../../ops/supabase/confirmation-patch.mjs"

it.each([undefined, null, "", "<p>No native token</p>"])(
  "rejects missing native OTP content",
  html => expect(() => hostedConfirmationPatch(html)).toThrow("Invalid hosted confirmation template"),
)

it.each([
  "http://localhost:3101", "http://127.0.0.1:3101",
  "http://backbeat:3101", "http://kong:8000", "http://mailpit:8025",
  "http://host.docker.internal:55322", "http://0.0.0.0:3101",
  "http://[::1]:3101", "https://host.docker.internal/path",
])("rejects the named local transport address %s", address => {
  const html = `<p>{{ .Token }}</p><a href="${address}">Local</a>`
  expect(() => hostedConfirmationPatch(html)).toThrow("Invalid hosted confirmation template")
})

it.each([
  '<a href="{{ .ConfirmationURL }}">Confirm</a>',
  '<p>{{ .Token }}</p><a href="{{ .ConfirmationURL }}">Confirm</a>',
  '<p>{{.Token}}</p><a href="{{.ConfirmationURL}}">Confirm</a>',
])("rejects native confirmation links in the code-only template", html => {
  expect(() => hostedConfirmationPatch(html)).toThrow("Invalid hosted confirmation template")
})

it.each(["{{ .Token }}", "{{.Token}}", "{{  .Token  }}"])(
  "accepts ordinary Go token whitespace without rewriting source: %s",
  token => {
    const html = `<p>${token}</p>`
    expect(hostedConfirmationPatch(html).mailer_templates_confirmation_content).toBe(html)
  },
)

it("uses the existing template bytes and only hosted template fields", () => {
  const html = readFileSync(fileURLToPath(new URL("../../public/auth/signup-confirmation.html", import.meta.url)), "utf8")
  expect(hostedConfirmationPatch(html)).toEqual({
    mailer_subjects_confirmation: "Confirm your Backbeat email",
    mailer_templates_confirmation_content: html,
  })
})
