'use client';

import { DecisionTable, type DecisionTableType } from '@gorules/jdm-editor';
import '@gorules/jdm-editor/dist/style.css';
import Box from '@mui/material/Box';

import { FEE_OUTPUT_SCHEMA, SCENARIO_FIELD_SCHEMA } from '@/lib/scenario-fields';

/// Standalone GoRules decision-table editor — the "simple" authoring mode.
/// Self-contained (creates its own store); `mode="business"` swaps cell
/// inputs for guided pickers and `inputsSchema`/`outputsSchema` power the
/// guided column catalogs. Read-only propagates through `disabled`, same
/// as the advanced graph editor.
export default function DecisionTableEditorInner({
  value,
  onChange,
  disabled,
}: {
  value: DecisionTableType;
  onChange: (v: DecisionTableType) => void;
  disabled?: boolean;
}) {
  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <DecisionTable
        tableHeight={560}
        value={value}
        onChange={onChange}
        disabled={disabled}
        mode="business"
        permission="edit:full"
        inputsSchema={SCENARIO_FIELD_SCHEMA}
        outputsSchema={FEE_OUTPUT_SCHEMA}
        mountDialogsOnBody
      />
    </Box>
  );
}
