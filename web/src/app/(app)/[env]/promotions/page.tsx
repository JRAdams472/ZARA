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
import ErrorPanel from '@/components/ErrorPanel';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Promotions — Zara' };

export default async function PromotionsPage({ params }: { params: Promise<{ env: string }> }) {
  const { env } = await params;
  let promotions;
  try {
    ({ promotions } = await mgmt.promotions(env as Env));
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
        Promotion history
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Append-only record of promotions into {env.toUpperCase()} — verbatim
        published copies, attributed by actor and graph hash.
      </Typography>
      {promotions.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.paper' }}>
          <Typography color="text.secondary">
            Nothing has been promoted into {env.toUpperCase()} yet.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Rule</TableCell>
                <TableCell>Path</TableCell>
                <TableCell>Graph SHA-256</TableCell>
                <TableCell>Promoted by</TableCell>
                <TableCell>At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {promotions.map((p) => (
                <TableRow key={`${p.artifactId}-${p.promotedAt}`} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{p.artifactKey}</TableCell>
                  <TableCell>
                    <Chip label={`${p.fromEnv.toUpperCase()} → ${p.toEnv.toUpperCase()}`} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {p.graphSha256.slice(0, 12)}…
                  </TableCell>
                  <TableCell>{p.promotedBy}</TableCell>
                  <TableCell>{new Date(p.promotedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
