import type { NextConfig } from "next";
import path from "node:path";
import { withWorkflow } from 'workflow/next';

const projectRoot = path.resolve(__dirname);

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // microphone=(self): el asistente de voz del tour necesita getUserMedia.
    value: "camera=(), microphone=(self), geolocation=(), payment=()",
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
      // Meta Pixel: fbevents.js + pixel.gif /tr (sin comodín *)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
      "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.tile.openstreetmap.org https://server.arcgisonline.com https://connect.facebook.net https://www.facebook.com",
      "media-src 'self' blob: https:",
      "worker-src 'self' blob:",
      "frame-src 'self' https://www.google.com https://maps.google.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['jspdf', 'fflate'],
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '192.168.0.111',
    '192.168.56.1',
    'www.lavilett.com',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '40mb',
    },
    proxyClientMaxBodySize: '150mb',
  },
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingRoot: projectRoot,
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
    const mediaCache = [
      { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
    ]
    return [
      { source: "/inicio/:path*", headers: mediaCache },
      { source: "/tour/ingreso.mp4", headers: mediaCache },
      { source: "/tour/ingreso/:path*", headers: mediaCache },
      { source: "/tour/ingreso-v2/:path*", headers: mediaCache },
      {
        source: "/tour/ingreso-v2/:path*.m4s",
        headers: [...mediaCache, { key: "Content-Type", value: "video/mp4" }],
      },
      { source: "/CUENCA1.webp", headers: mediaCache },
      { source: "/CUENCA2.webp", headers: mediaCache },
      { source: "/CUENCA4.webp", headers: mediaCache },
      { source: "/lavilet-sala.webp", headers: mediaCache },
      { source: "/lavilet-comedor.webp", headers: mediaCache },
      { source: "/lavilet-exterior.webp", headers: mediaCache },
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

export default withWorkflow(nextConfig);
