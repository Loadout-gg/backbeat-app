import { afterEach, expect, it, vi } from "vitest"
import { register } from "@/instrumentation"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it("records only the Node runtime version in server logs", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs")
  const info = vi.spyOn(console, "info").mockImplementation(() => {})
  await register()
  expect(info).toHaveBeenCalledTimes(1)
  expect(info).toHaveBeenCalledWith(JSON.stringify({
    event: "backbeat.runtime", node: process.versions.node,
  }))
})

it.each(["edge", undefined])("does not emit a Node event for runtime %s", async runtime => {
  vi.stubEnv("NEXT_RUNTIME", runtime)
  const info = vi.spyOn(console, "info").mockImplementation(() => {})
  await register()
  expect(info).not.toHaveBeenCalled()
})
