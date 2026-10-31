import { redirect } from 'next/navigation';
import { isLive, readSession } from '@/lib/session';
import { ApiError, firstEffectiveEnv, mgmt } from '@/lib/api';

/** Entry point: session → first env the caller may use → rules view.
 *  No session → login; no effective envs → the shell's access page. */
export default async function Home() {
  if (!isLive(await readSession())) redirect('/login');
  try {
    const who = await mgmt.whoami();
    const env = firstEffectiveEnv(who);
    redirect(env ? `/${env}/rules` : '/no-access');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) redirect('/login');
    throw e;
  }
}
