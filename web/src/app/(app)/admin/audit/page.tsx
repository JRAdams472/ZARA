import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ApiError, mgmt } from '@/lib/api';
import ErrorPanel from '@/components/ErrorPanel';
import AuditTail from '@/components/AuditTail';

export const metadata = { title: 'Audit trail — Zara' };

export default async function AuditPage() {
  let events;
  let verify;
  try {
    [{ events }, verify] = await Promise.all([mgmt.auditEvents(100), mgmt.verifyAudit()]);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return <ErrorPanel title="Access denied" detail={e.message} />;
    }
    throw e;
  }

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        Audit trail
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Append-only, hash-chained control-plane events — newest first. Chain
        verification recomputes every link in PostgreSQL order.
      </Typography>
      <AuditTail events={events} verify={verify} />
    </Box>
  );
}
