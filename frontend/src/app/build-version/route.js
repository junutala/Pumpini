// GET /build-version → { build } for the CURRENTLY DEPLOYED frontend, uncached.
// A running tab compares this to its own baked-in NEXT_PUBLIC_BUILD_ID and, when
// they differ, offers a one-tap refresh (see AppUpdater). This is how a device
// that's holding a stale build gets pulled onto the latest one.
//
// NOTE: this route deliberately lives OUTSIDE /api/* — next.config rewrites every
// /api/* path to the Railway backend, so an /api/version route would never reach
// this handler.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export function GET() {
  const build = (process.env.VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 7);
  return new Response(JSON.stringify({ build }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
