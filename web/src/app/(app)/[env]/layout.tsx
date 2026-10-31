import { redirect } from 'next/navigation';
import { ApiError, ENVS, firstEffectiveEnv, mgmt, type Env } from '@/lib/api';
import { isLive, readSession } from '@/lib/session';
import AppShell from '@/components/AppShell';

/** Authed, env-gated shell: session → whoami → env ∈ effectiveEnvs.
 *  A token whose claims don't reach this env never renders its pages —
 *  the mgmt gate would 403 anyway; we just fail earlier and friendlier. */
export default async function EnvLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ env: string }>;
}) {
  const { env: envParam } = await params;
  const session = await readSession();
  if (!isLive(session)) {
    redirect(`/auth/login?next=${encodeURIComponent(`/${envParam}`)}`);
  }

  let who;
  try {
    who = await mgmt.whoami();
  } catch (e) {
    // 401 → stale session; the login flow overwrites the cookie anyway.
    if (e instanceof ApiError && e.status === 401) {
      redirect(`/auth/login?next=${encodeURIComponent(`/${envParam}`)}`);
    }
    throw e;
  }

  const env = ENVS.find((e) => e === envParam);
  if (!env) redirect('/not-found');

  if (!who.effectiveEnvs.includes(env)) {
    const first = firstEffectiveEnv(who);
    redirect(first ? `/${first}/rules` : '/no-access');
  }

  return (
    <AppShell whoami={who} env={env as Env} email={session.email}>
      {children}
    </AppShell>
  );
}
