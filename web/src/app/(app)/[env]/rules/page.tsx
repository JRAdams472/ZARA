import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ApiError, mgmt, type Env } from '@/lib/api';
import RulesTable from '@/components/RulesTable';
import ErrorPanel from '@/components/ErrorPanel';
import NewRuleButton from '@/components/NewRuleButton';
import { canWriteEnv } from '@/lib/gate';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Rules — Zara' };

export default async function RulesPage({ params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  let rules;
  let who;
  try {
    ({ rules } = await mgmt.rules(env as Env));
    who = await mgmt.whoami();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return <ErrorPanel title="Access denied" detail={e.message} />;
    }
    throw e;
  }

  const canWrite = canWriteEnv(who, env as Env);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h5" component="h1" sx={{ flexGrow: 1 }}>
          Rules
        </Typography>
        {canWrite && <NewRuleButton env={env as Env} />}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fee artifacts in {env.toUpperCase()} — drafts are editable in DEV only;
        published rows are immutable.
      </Typography>
      <RulesTable env={env as Env} rules={rules} canWrite={canWrite} />
    </Box>
  );
}
