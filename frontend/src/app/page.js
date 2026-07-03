import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Landing router: send a logged-in visitor to the right home for their role —
// operators straight to their settlement screen (they never see the dashboard),
// owners to the group view, everyone else to the outlet dashboard. Anonymous →
// public landing. The role is read from the token for routing only; every API
// call is still authorised server-side.
function roleFromToken(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role || null;
  } catch { return null; }
}

export default function RootPage() {
  const token = cookies().get('token')?.value;
  if (!token) redirect('/landing');
  const role = roleFromToken(token);
  redirect(
    role === 'attendant' ? '/settlement'
    : role === 'owner' ? '/group-dashboard'   // group rollup is owner-only (margins/analysis)
    : '/dashboard'                            // manager, CCO, rsa… land on the outlet cockpit
  );
}
