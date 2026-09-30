"use client"

import { useSyncExternalStore } from "react"
const subscribe = () => () => {}
// Keep tab-only draft reads out of server render and the initial hydration pass.
export function useAuthClientReady() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
