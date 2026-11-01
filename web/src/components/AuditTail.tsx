'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import type { AuditEvent, AuditVerifyResult } from '@/lib/types';

/** Audit tail — dense event table with per-row detail reveal and the
 *  chain-verification verdict on top. Read-only by nature: the chain is
 *  append-only at the DB layer. */
export default function AuditTail({
  events,
  verify,
}: {
  events: AuditEvent[];
  verify: AuditVerifyResult;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Box>
      <Alert
        severity={verify.ok ? 'success' : 'error'}
        variant="outlined"
        sx={{ mb: 2 }}
        icon={false}
      >
        {verify.ok
          ? `Chain verified — ${verify.checked} event${verify.checked === 1 ? '' : 's'}, no breaks`
          : `Chain broken at event ${verify.firstBadId} (${verify.reason ?? 'unknown'}) after ${verify.checked} events`}
      </Alert>
      <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: 'background.paper' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell width={40} />
              <TableCell>ID</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Actor</TableCell>
              <TableCell>Occurred</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {events.map((e) => (
              <EventRow
                key={e.id}
                event={e}
                open={openId === e.id}
                onToggle={() => setOpenId(openId === e.id ? null : e.id)}
              />
            ))}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                  No audit events recorded yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

function EventRow({
  event,
  open,
  onToggle,
}: {
  event: AuditEvent;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow hover onClick={onToggle} sx={{ cursor: 'pointer' }}>
        <TableCell>
          <IconButton size="small" aria-label="toggle detail">
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{event.id}</TableCell>
        <TableCell>
          <Chip label={event.action} size="small" variant="outlined" />
        </TableCell>
        <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{event.actorSub}</TableCell>
        <TableCell>{new Date(event.occurredAt).toLocaleString()}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ py: 0, borderBottom: open ? undefined : 0 }}>
          <Collapse in={open} unmountOnExit>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.5,
                fontSize: 12,
                fontFamily: 'monospace',
                overflowX: 'auto',
                color: 'text.secondary',
              }}
            >
              {JSON.stringify(event.detail, null, 2)}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}
