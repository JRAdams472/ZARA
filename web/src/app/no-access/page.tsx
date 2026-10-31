import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

export const metadata = { title: 'No access — Zara' };

/** Signed-in caller with zero effective environments — claims ∩ role
 *  scope is empty everywhere. Fail friendly, never a redirect loop. */
export default function NoAccess() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
        <Typography variant="h5" gutterBottom>
          No environment access
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Your identity is valid, but no role grant gives you access to any Zara
          environment. Ask your administrator for a grant.
        </Typography>
        <Button variant="outlined" href="/auth/logout">
          Sign out
        </Button>
      </Box>
    </Box>
  );
}
