import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.tile.openstreetmap.org https://server.arcgisonline.com",
      "media-src 'self' blob: https:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://www.google.com https://maps.google.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.0.111'],
  experimental: {
    serverActions: {
      bodySizeLimit: '40mb',
    },
    proxyClientMaxBodySize: '40mb',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
  async headers() {
    const htmlPlanHeaders = [
      { key: "X-DNS-Prefetch-Control", value: "on" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      {
        key: "Content-Security-Policy",
        value: [
          "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
          "img-src 'self' data: blob:",
          "style-src 'self' 'unsafe-inline'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
          "worker-src 'self' blob:",
          "connect-src 'self'",
          "frame-ancestors 'self'",
        ].join("; "),
      },
    ];
    return [
      {
        source: "/api/tour/floor-plan-html",
        headers: htmlPlanHeaders,
      },
      {
        // Evita doble CSP (Next concatena headers de varias reglas).
        source: "/((?!api/tour/floor-plan-html).*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
