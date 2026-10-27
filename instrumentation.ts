export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.info(JSON.stringify({ event: "backbeat.runtime", node: process.versions.node }))
  }
}
