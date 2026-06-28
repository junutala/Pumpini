/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: { unoptimized: true },
  // Build id of this deploy, baked into the client bundle so a running tab can
  // tell when a newer build has gone live (compared against /build-version).
  env: {
    NEXT_PUBLIC_BUILD_ID: (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7),
  },
  // Lint runs separately (`npm run lint`); pre-existing rule violations across
  // the app should not block production builds. Matches current Vercel behaviour.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/:path*` }
    ];
  },
  webpack: (config) => {
    // pdfjs-dist tries to require the native 'canvas' module (Node-only); we
    // render to a browser <canvas>, so stub it out to keep the build clean.
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};
module.exports = nextConfig;
