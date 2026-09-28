/** @type {import('next').NextConfig} */
const nextConfig = {
  // A server-only local flag must also guard the browser bundle.
  ...(process.env.BACKBEAT_ENV === "development" ? {
    env: { NEXT_PUBLIC_BACKBEAT_ENV: "development" },
  } : {}),
  images: {
    unoptimized: true,
  },
 
}

export default nextConfig
