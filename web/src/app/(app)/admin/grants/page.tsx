import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { ApiError, mgmt } from '@/lib/api';
import ErrorPanel from '@/components/ErrorPanel';
import GrantsAdmin from '@/components/GrantsAdmin';

export const metadata = { title: 'Role grants — Zara' };

export default async function GrantsPage() {
  let grants;
  try {
    ({ grants } = await mgmt.grants());
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      return <ErrorPanel title="Access denied" detail={e.message} />;
    }
    throw e;
  }

  return (
    <Box>
      <Typography variant="h5" component="h1" gutterBottom>
        Role grants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Who holds which role in this tenant. Grants resolve at request time
        (30s cache); the last release manager cannot be revoked.
      </Typography>
      <GrantsAdmin initialGrants={grants} />
    </Box>
  );
}
