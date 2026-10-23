/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.BACKBEAT_ENV === 'development' ? {
    env: { NEXT_PUBLIC_BACKBEAT_ENV: 'development' },
  } : {}),
  images: { unoptimized: true },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'" },
      ],
    }]
  },
}
export default nextConfig
