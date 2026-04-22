/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // serverActions are stable in Next 15.1+; bodySizeLimit moved out of the
  // `experimental` namespace. Upload pathway for documents uses a FormData
  // POST to a Route Handler (not a server action), so 25 MB is the limit
  // we care about there — already enforced in the route. Keeping this key
  // as a defence-in-depth in case a future contributor wires an action.
  serverActions: { bodySizeLimit: "25mb" },
  async headers() {
    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      {
        key: "Content-Security-Policy",
        value:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      },
    ];
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, no-cache, must-revalidate, private" }] },
    ];
  },
};

export default nextConfig;
