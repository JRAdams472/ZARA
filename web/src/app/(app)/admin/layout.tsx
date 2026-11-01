import { redirect } from 'next/navigation';
import { ApiError, mgmt } from '@/lib/api';
import { isLive, readSession } from '@/lib/session';
import AppShell from '@/components/AppShell';
import ErrorPanel from '@/components/ErrorPanel';

/** Tenant-admin shell — tenant-scoped (no env), Release-Manager only.
 *  The UI hides admin nav for other roles; this layout additionally
 *  blocks direct URL access with an explicit restriction message, and
 *  mgmt 403s the underlying calls regardless. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (!isLive(session)) {
    redirect(`/auth/login?next=${encodeURIComponent('/admin/grants')}`);
  }

  let who;
  try {
    who = await mgmt.whoami();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      redirect(`/auth/login?next=${encodeURIComponent('/admin/grants')}`);
    }
    throw e;
  }

  if (!who.roles.includes('tenant_release_manager')) {
    return (
      <AppShell whoami={who} env={who.effectiveEnvs[0] ?? 'dev'} email={session.email}>
        <ErrorPanel
          title="Restricted"
          detail="Tenant administration requires the Release Manager role."
        />
      </AppShell>
    );
  }

  return (
    <AppShell whoami={who} env={who.effectiveEnvs[0] ?? 'dev'} email={session.email}>
      {children}
    </AppShell>
  );
}
