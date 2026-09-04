import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: ['localhost', '127.0.0.1', '192.168.0.111'],
  experimental: {
    serverActions: {
      bodySizeLimit: '80mb',
    },
    proxyClientMaxBodySize: '80mb',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'placehold.co' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

export default nextConfig;
