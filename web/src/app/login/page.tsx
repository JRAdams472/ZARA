import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import { readSession } from '@/lib/session';

export const metadata = { title: 'Sign in — Zara' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  if (await readSession()) redirect(next?.startsWith('/') && !next.startsWith('//') ? next : '/');

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
      }}
    >
      <Card variant="outlined" sx={{ width: 380, bgcolor: 'background.paper' }}>
        <CardContent sx={{ p: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, color: 'primary.main' }}>
            Zara
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Mortgage fee rule management — sign in with your organization identity.
          </Typography>
          {error && (
            <Typography variant="body2" sx={{ color: '#f85149' }} role="alert">
              {error}
            </Typography>
          )}
          <Button
            variant="contained"
            size="large"
            href={`/auth/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}
            sx={{ mt: 1 }}
          >
            Sign in with SSO
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
