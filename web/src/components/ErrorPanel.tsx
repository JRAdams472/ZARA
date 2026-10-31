import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

/** In-content error surface — access denials render as panels, not crashes. */
export default function ErrorPanel({ title, detail }: { title: string; detail?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      {detail && (
        <Typography variant="body2" color="text.secondary">
          {detail}
        </Typography>
      )}
    </Paper>
  );
}
