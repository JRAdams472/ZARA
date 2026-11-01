'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

import { ClientApiError, endpoints } from '@/lib/client';
import type { GrantRow } from '@/lib/types';

const SUBJECT_TYPES = ['sub', 'email', 'aud'] as const;
const ROLES = ['tenant_rule_engineer', 'tenant_release_manager', 'tenant_auditor'] as const;
const ROLE_SHORT: Record<string, string> = {
  tenant_rule_engineer: 'engineer',
  tenant_release_manager: 'release manager',
  tenant_auditor: 'auditor',
};

/** Grants admin island — RM-only page already gates access; mutations
 *  through /bff where mgmt re-checks the role and audits every write. */
export default function GrantsAdmin({ initialGrants }: { initialGrants: GrantRow[] }) {
  const queryClient = useQueryClient();
  const [grants, setGrants] = useState(initialGrants);
  const [open, setOpen] = useState(false);
  const [subjectType, setSubjectType] = useState<string>(SUBJECT_TYPES[1]);
  const [subject, setSubject] = useState('');
  const [role, setRole] = useState<string>(ROLES[0]);
  const [confirmRevoke, setConfirmRevoke] = useState<GrantRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['grants'] });
    const { grants: fresh } = await endpoints.grants();
    setGrants(fresh);
  };

  const put = useMutation({
    mutationFn: () =>
      endpoints.putGrant({ subjectType, subject: subject.trim(), role }),
    onSuccess: async () => {
      setOpen(false);
      setSubject('');
      await refresh();
    },
    onError: (e) => setError(e instanceof ClientApiError ? e.message : `${e}`),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.deleteGrant(id),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof ClientApiError ? e.message : `${e}`),
  });

  const valid = subject.trim().length > 0 && subject.trim().length <= 256;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" size="small" onClick={() => setOpen(true)}>
          New grant
        </Button>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Subject type</TableCell>
              <TableCell>Subject</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Granted by</TableCell>
              <TableCell>Granted at</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {grants.map((g) => (
              <TableRow key={g.id} hover>
                <TableCell>
                  <Chip label={g.subjectType} size="small" variant="outlined" />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{g.subject}</TableCell>
                <TableCell>{ROLE_SHORT[g.role] ?? g.role}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{g.grantedBy}</TableCell>
                <TableCell>{new Date(g.grantedAt).toLocaleString()}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Revoke grant">
                    <IconButton
                      size="small"
                      onClick={() => setConfirmRevoke(g)}
                      aria-label={`revoke ${g.subject}`}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {grants.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No grants — add the first with New grant.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New role grant</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="Subject type"
            size="small"
            select
            value={subjectType}
            onChange={(e) => setSubjectType(e.target.value)}
          >
            {SUBJECT_TYPES.map((t) => (
              <MenuItem key={t} value={t}>
                {t}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Subject"
            size="small"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            helperText="JWT sub, email address, or audience identifier"
            autoFocus
          />
          <TextField
            label="Role"
            size="small"
            select
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <MenuItem key={r} value={r}>
                {ROLE_SHORT[r]}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!valid || put.isPending}
            onClick={() => {
              setError(null);
              put.mutate();
            }}
          >
            {put.isPending ? 'Granting…' : 'Grant'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmRevoke !== null} onClose={() => setConfirmRevoke(null)}>
        <DialogTitle>Revoke grant?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {confirmRevoke?.subject} loses the{' '}
            {confirmRevoke ? ROLE_SHORT[confirmRevoke.role] : ''} role immediately
            (30s cache). The tenant&apos;s last release manager cannot be revoked.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRevoke(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={revoke.isPending}
            onClick={() => {
              const g = confirmRevoke;
              setConfirmRevoke(null);
              if (g) revoke.mutate(g.id);
            }}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
