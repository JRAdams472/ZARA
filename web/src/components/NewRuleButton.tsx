'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

import { ClientApiError, endpoints } from '@/lib/client';
import type { Env } from '@/lib/types';

const KINDS = ['base_fee', 'adjustment_set'] as const;
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const STARTER_JDM = {
  nodes: [
    { id: 'in', type: 'inputNode', name: 'Loan scenario', position: { x: 0, y: 0 } },
    { id: 'out', type: 'outputNode', name: 'Fees', position: { x: 480, y: 0 } },
  ],
  edges: [{ id: 'e1', sourceId: 'in', targetId: 'out' }],
};

/** "New rule" affordance — the parent page only renders this when the
 *  caller holds dev-write. Creates a draft with a starter graph, then
 *  sends the user to its editor. */
export default function NewRuleButton({ env }: { env: Env }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [kind, setKind] = useState<string>(KINDS[0]);
  const [formError, setFormError] = useState<string | null>(null);

  const valid = KEY_RE.test(key.trim());

  const create = useMutation({
    mutationFn: () =>
      endpoints.createRule(env, { key: key.trim(), kind, spec: STARTER_JDM }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['rules', env] });
      setOpen(false);
      router.push(`/${env}/rules/${encodeURIComponent(key.trim())}`);
      router.refresh();
    },
    onError: (e) =>
      setFormError(e instanceof ClientApiError ? e.message : `${e}`),
  });

  return (
    <>
      <Button variant="contained" size="small" onClick={() => setOpen(true)}>
        New rule
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New rule draft</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          {formError && <Alert severity="error">{formError}</Alert>}
          <TextField
            label="Key"
            size="small"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            error={key.length > 0 && !valid}
            helperText="lowercase letters, digits, . _ -  (e.g. origination.base)"
            autoFocus
          />
          <TextField
            label="Kind"
            size="small"
            select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {KINDS.map((k) => (
              <MenuItem key={k} value={k}>
                {k}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!valid || create.isPending}
            onClick={() => {
              setFormError(null);
              create.mutate();
            }}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
