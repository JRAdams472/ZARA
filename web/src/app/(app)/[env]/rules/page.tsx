import Link from 'next/link';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { ApiError, mgmt, type Env } from '@/lib/api';
import StatusChip from '@/components/StatusChip';
import ErrorPanel from '@/components/ErrorPanel';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Rules — Zara' };

export default async function RulesPage({ params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  let rules;
  try {
    ({ rules } = await mgmt.rules(env as Env));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return <ErrorPanel title="Access denied" detail={e.message} />;
    }
    throw e;
  }

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        Rules
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Fee artifacts in {env.toUpperCase()} — drafts are editable in DEV only;
        published rows are immutable.
      </Typography>
      {rules.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.paper' }}>
          <Typography color="text.secondary">
            No rule artifacts in {env.toUpperCase()} yet.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>SHA-256</TableCell>
                <TableCell>Updated</TableCell>
                <TableCell>Published</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={`${r.key}-${r.status}`} hover>
                  <TableCell>
                    <Link
                      href={`/${env}/rules/${encodeURIComponent(r.key)}`}
                      style={{ color: '#58a6ff', textDecoration: 'none' }}
                    >
                      {r.key}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Chip label={r.kind} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <StatusChip status={r.status} />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {r.sha256 ? `${r.sha256.slice(0, 12)}…` : '—'}
                  </TableCell>
                  <TableCell>{new Date(r.updatedAt).toLocaleString()}</TableCell>
                  <TableCell>{r.publishedAt ? new Date(r.publishedAt).toLocaleString() : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
