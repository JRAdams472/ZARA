'use client';

import { useState } from 'react';
import Link from 'next/link';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import StatusChip from './StatusChip';
import type { Env, RuleMeta } from '@/lib/types';

/** Dense artifact table with a filter input above it (PRODUCT.md
 *  anatomy: tables stay compact, detail lives behind row → detail).
 *  Filters client-side over key/kind/status — the row set is already
 *  tenant+env scoped by mgmt. */
export default function RulesTable({
  env,
  rules,
  canWrite,
}: {
  env: Env;
  rules: RuleMeta[];
  canWrite: boolean;
}) {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();
  const rows = q
    ? rules.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.kind.toLowerCase().includes(q) ||
          r.status.includes(q),
      )
    : rules;

  if (rules.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.paper' }}>
        <Typography color="text.secondary">
          {canWrite && env === 'dev'
            ? 'No rule artifacts in DEV yet — create the first draft with New rule.'
            : `No rule artifacts in ${env.toUpperCase()} yet.`}
        </Typography>
      </Paper>
    );
  }

  return (
    <>
      <TextField
        size="small"
        placeholder="Filter by key, kind, or status"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        sx={{ mb: 1.5, width: 320 }}
      />
      <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Key</TableCell>
              <TableCell>Kind</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>SHA-256</TableCell>
              <TableCell>Updated</TableCell>
              <TableCell>Published</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.key}-${r.status}`} hover>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  <Link
                    href={`/${env}/rules/${encodeURIComponent(r.key)}`}
                    style={{ color: '#58a6ff', textDecoration: 'none' }}
                  >
                    {r.key}
                  </Link>
                </TableCell>
                <TableCell>
                  <Chip label={r.kind} size="small" variant="outlined" />
                </TableCell>
                <TableCell>
                  <StatusChip status={r.status} />
                </TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {r.sha256 ? `${r.sha256.slice(0, 12)}…` : '—'}
                </TableCell>
                <TableCell>{new Date(r.updatedAt).toLocaleString()}</TableCell>
                <TableCell>{r.publishedAt ? new Date(r.publishedAt).toLocaleString() : '—'}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  No artifacts match &ldquo;{filter}&rdquo; — clear the filter to see all.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}
