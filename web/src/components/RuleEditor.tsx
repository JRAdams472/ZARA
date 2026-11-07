'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Snackbar from '@mui/material/Snackbar';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import type { DecisionGraphType, DecisionTableType } from '@gorules/jdm-editor';

import DecisionEditor from './DecisionEditor';
import DecisionTableEditor from './DecisionTableEditor';
import { ClientApiError, endpoints } from '@/lib/client';
import { canonicalJson } from '@/lib/gate';
import { findSimpleTable, patchTableContent } from '@/lib/jdm';
import type { Env, RuleDetail } from '@/lib/types';

function mutationError(e: unknown): string {
  if (e instanceof ClientApiError) return e.message;
  return `${e}`;
}

/**
 * JDM editor island — mounted by the server-rendered detail page with
 * the fetched artifact. Mutations go through /bff; mgmt enforces the
 * DEV-only + dev-write contract server-side (`canWrite` only decides
 * which affordances render). After every mutation: invalidate the React
 * Query keys Phase 3 client views will read, then `router.refresh()` to
 * re-fetch this server-rendered page.
 */
export default function RuleEditor({
  env,
  ruleKey,
  initialRule,
  canWrite,
}: {
  env: Env;
  ruleKey: string;
  initialRule: RuleDetail;
  canWrite: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const rule = initialRule;
  const draft = rule.status === 'draft';
  const editable = canWrite && env === 'dev' && draft;

  // `edited` holds unsaved graph changes; absent edits, the editor shows
  // the persisted jdm — the canonical graph column (seeded rows carry a
  // fee descriptor in `spec`, so jdm is the graph source of truth). The
  // editor emits onChange once on mount with the loaded graph — only a
  // payload that differs from jdm counts as a user edit.
  const [edited, setEdited] = useState<DecisionGraphType | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishedSha, setPublishedSha] = useState<string | null>(null);
  const dirty = edited !== null;

  const jdm = (rule.jdm ?? rule.spec) as DecisionGraphType;
  const graph = edited ?? jdm;

  // "Simple" editing = standalone decision-table view when the graph holds
  // exactly one decisionTableNode; `null` view = not chosen yet (defaults to
  // simple when eligible, advanced otherwise).
  const simple = findSimpleTable(graph);
  const [view, setView] = useState<'simple' | 'advanced' | null>(null);
  const effectiveView = view ?? (simple.ok ? 'simple' : 'advanced');

  const onTableChange = (table: DecisionTableType) => {
    if (!editable || !simple.ok) return;
    // The editor emits on mount with the normalized table — only an actual
    // content change counts as a user edit.
    const current = (graph.nodes ?? []).find((n) => n.id === simple.nodeId)?.content;
    if (canonicalJson(table) === canonicalJson(current)) return;
    const next = patchTableContent(graph, simple.nodeId, table);
    setEdited(canonicalJson(next) === canonicalJson(jdm) ? null : next);
  };

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['rules', env] });
    await queryClient.invalidateQueries({ queryKey: ['rule', env, ruleKey] });
    router.refresh();
  };

  const save = useMutation({
    mutationFn: () => endpoints.saveRule(env, ruleKey, edited),
    onSuccess: async () => {
      setEdited(null);
      await refresh();
    },
  });

  const publish = useMutation({
    mutationFn: () => endpoints.publishRule(env, ruleKey),
    onSuccess: async ({ sha256 }) => {
      setEdited(null);
      setPublishedSha(sha256);
      await refresh();
    },
  });

  /** New-draft-from-published — published rows never mutate; minting a
   *  working copy from the published graph is the only "edit" offered. */
  const newDraft = useMutation({
    mutationFn: () =>
      endpoints.createRule(env, { key: ruleKey, kind: rule.kind, spec: jdm }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => endpoints.deleteRule(env, ruleKey),
    onSuccess: async () => {
      await refresh();
      router.push(`/${env}/rules`);
    },
  });

  const error =
    (save.isError && mutationError(save.error)) ||
    (publish.isError && mutationError(publish.error)) ||
    (remove.isError && mutationError(remove.error)) ||
    (newDraft.isError && mutationError(newDraft.error)) ||
    null;

  return (
    <Box>
      {editable && (
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
          <Button
            variant="contained"
            size="small"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save draft'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            disabled={dirty || publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? 'Publishing…' : 'Publish'}
          </Button>
          <Button
            variant="outlined"
            size="small"
            color="error"
            disabled={remove.isPending}
            onClick={() => setConfirmDelete(true)}
          >
            Delete draft
          </Button>
          {dirty && (
            <Chip label="unsaved changes" size="small" color="warning" variant="outlined" />
          )}
        </Box>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      {!draft && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            canWrite && env === 'dev' ? (
              <Button
                size="small"
                color="inherit"
                disabled={newDraft.isPending}
                onClick={() => newDraft.mutate()}
              >
                {newDraft.isPending ? 'Creating…' : 'New draft'}
              </Button>
            ) : undefined
          }
        >
          Published artifacts are immutable — this graph is read-only.
          {canWrite && env === 'dev' ? ' Create a new draft from it to make changes.' : ''}
        </Alert>
      )}
      {draft && !editable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {env === 'dev'
            ? 'Your role has read access to DEV — drafts are editable by rule engineers and release managers.'
            : `Drafts live in DEV — ${env.toUpperCase()} shows published artifacts only.`}
        </Alert>
      )}

      <ToggleButtonGroup
        size="small"
        exclusive
        value={effectiveView}
        onChange={(_, v) => v && setView(v)}
        sx={{ mb: 1.5 }}
      >
        <ToggleButton value="simple">Simple</ToggleButton>
        <ToggleButton value="advanced">Advanced</ToggleButton>
      </ToggleButtonGroup>

      {effectiveView === 'simple' ? (
        simple.ok ? (
          <DecisionTableEditor
            value={simple.table}
            onChange={onTableChange}
            disabled={!editable}
          />
        ) : (
          <Alert severity="info">
            {simple.reason === 'none'
              ? 'This rule has no decision table — add a decision table node in Advanced mode.'
              : 'This rule contains multiple decision tables — use Advanced mode to edit them.'}
          </Alert>
        )
      ) : (
        <DecisionEditor
          value={graph}
          onChange={(v) => {
            if (!editable || !v) return;
            setEdited(canonicalJson(v) === canonicalJson(jdm) ? null : v);
          }}
          disabled={!editable}
        />
      )}

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete draft {ruleKey}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The draft and its unpublished edits are removed. Published revisions are unaffected.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() => {
              setConfirmDelete(false);
              remove.mutate();
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={publishedSha !== null}
        autoHideDuration={10000}
        onClose={() => setPublishedSha(null)}
        message={
          publishedSha ? (
            <span>
              Published — sha256{' '}
              <span style={{ fontFamily: 'monospace' }}>{publishedSha}</span>
            </span>
          ) : undefined
        }
      />
    </Box>
  );
}
