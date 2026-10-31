import Chip from '@mui/material/Chip';

/** Artifact status — published = immutable (success tone), draft = WIP. */
export default function StatusChip({ status }: { status: 'draft' | 'published' }) {
  return (
    <Chip
      label={status}
      size="small"
      color={status === 'published' ? 'success' : 'default'}
      variant={status === 'published' ? 'filled' : 'outlined'}
    />
  );
}
