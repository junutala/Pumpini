import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

// Logged-in visitors go straight to their dashboard; everyone else sees the
// public landing page (which has a Login button in the top-right navbar).
export default function RootPage() {
  const token = cookies().get('token');
  redirect(token ? '/dashboard' : '/landing');
}
