/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // Lint runs separately (`npm run lint`); pre-existing rule violations across
  // the app should not block production builds. Matches current Vercel behaviour.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*` }
    ];
  },
};
module.exports = nextConfig;
