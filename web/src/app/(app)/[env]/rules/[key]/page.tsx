import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { notFound } from 'next/navigation';
import { ApiError, mgmt, type Env } from '@/lib/api';
import StatusChip from '@/components/StatusChip';
import ErrorPanel from '@/components/ErrorPanel';
import RuleEditor from '@/components/RuleEditor';
import { canWriteEnv } from '@/lib/gate';

export const metadata = { title: 'Rule detail — Zara' };

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={mono ? { fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' } : undefined}
      >
        {value}
      </Typography>
    </Box>
  );
}

export default async function RuleDetailPage({
  params,
}: {
  params: Promise<{ env: string; key: string }>;
}) {
  const { env, key } = await params;
  let rule;
  let who;
  try {
    ({ rule } = await mgmt.rule(env as Env, key));
    who = await mgmt.whoami();
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return <ErrorPanel title="Access denied" detail={e.message} />;
    }
    throw e;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <Typography variant="h5" component="h1">
          {rule.key}
        </Typography>
        <StatusChip status={rule.status} />
        <Chip label={rule.kind} size="small" variant="outlined" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {env.toUpperCase()} · {canWriteEnv(who, env as Env) ? 'write' : 'read-only'} access ·{' '}
        {rule.status === 'draft' ? 'working copy' : 'immutable revision'}
      </Typography>

      <Paper variant="outlined" sx={{ p: 3, mb: 3, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2 }}>
          <Field label="SHA-256" mono value={rule.sha256 ?? '—'} />
          <Field label="Created by" value={rule.createdBy} />
          <Field label="Created" value={new Date(rule.createdAt).toLocaleString()} />
          <Field label="Updated" value={new Date(rule.updatedAt).toLocaleString()} />
          <Field
            label="Published"
            value={rule.publishedAt ? new Date(rule.publishedAt).toLocaleString() : '—'}
          />
        </Box>
      </Paper>

      <Typography variant="h6" gutterBottom>
        Decision graph
      </Typography>
      <RuleEditor
        env={env as Env}
        ruleKey={rule.key}
        initialRule={rule}
        canWrite={canWriteEnv(who, env as Env)}
      />
    </Box>
  );
}
