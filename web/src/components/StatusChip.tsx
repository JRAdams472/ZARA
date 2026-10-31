import Chip from '@mui/material/Chip';

/** Artifact status — published = immutable (success outline), draft =
 *  mutable working copy (warning outline). House convention per
 *  PRODUCT.md sibling rule-editor anatomy. */
export default function StatusChip({ status }: { status: 'draft' | 'published' }) {
  return (
    <Chip
      label={status}
      size="small"
      color={status === 'published' ? 'success' : 'warning'}
      variant="outlined"
    />
  );
}
