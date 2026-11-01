'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Snackbar from '@mui/material/Snackbar';
import Typography from '@mui/material/Typography';

import { ClientApiError, endpoints } from '@/lib/client';
import type { Env, PromoteResult } from '@/lib/types';

/** Promotion affordance — rendered only when the artifact is published
 *  AND the caller's role may promote into the derived target (computed
 *  server-side, same rule mgmt enforces). The UI shows the exact move
 *  (`dev→qa`) so the operator signs off on an adjacent step — skipping
 *  environments is inexpressible by construction. */
export default function PromoteButton({
  env,
  ruleKey,
  toEnv,
  sha256,
}: {
  env: Env;
  ruleKey: string;
  toEnv: Env;
  sha256: string | null;
}) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<PromoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const promote = useMutation({
    mutationFn: () => endpoints.promoteRule(env, ruleKey),
    onSuccess: async (r) => {
      setDone(r);
      await queryClient.invalidateQueries({ queryKey: ['rules', env] });
      await queryClient.invalidateQueries({ queryKey: ['rule', env, ruleKey] });
      await queryClient.invalidateQueries({ queryKey: ['promotions', r.toEnv] });
    },
    onError: (e) =>
      setError(e instanceof ClientApiError ? e.message : `${e}`),
  });

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={() => {
          setError(null);
          setConfirm(true);
        }}
      >
        Promote to {toEnv.toUpperCase()}
      </Button>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} fullWidth maxWidth="xs">
        <DialogTitle>
          Promote {ruleKey} — {env.toUpperCase()} → {toEnv.toUpperCase()}?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Copies the published artifact verbatim into {toEnv.toUpperCase()} and appends
            a promotion-history row. The source row is unchanged.
          </Typography>
          {sha256 && (
            <Typography
              variant="body2"
              sx={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}
            >
              {sha256}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={promote.isPending}
            onClick={() => {
              setConfirm(false);
              promote.mutate();
            }}
          >
            {promote.isPending ? 'Promoting…' : 'Promote'}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={done !== null}
        autoHideDuration={10000}
        onClose={() => setDone(null)}
        message={
          done ? (
            <span>
              Promoted {done.fromEnv.toUpperCase()} → {done.toEnv.toUpperCase()} — sha256{' '}
              <span style={{ fontFamily: 'monospace' }}>{done.sha256}</span>
              {done.published
                ? ' — pushed to engine'
                : ' — engine publish pending (poller converges)'}
            </span>
          ) : undefined
        }
      />
    </>
  );
}
