//! Detect/patch helpers for the simple (business) decision-table editor —
//! single-table detection and the surgical content patch that keeps the
//! rest of the JDM graph intact.

import { describe, expect, it } from 'vitest';
import type { DecisionGraphType, DecisionTableType } from '@gorules/jdm-editor';

import { findSimpleTable, patchTableContent } from '@/lib/jdm';

const TABLE: DecisionTableType = {
  hitPolicy: 'first',
  inputs: [{ id: 'i1', name: 'Loan purpose', field: 'loan.purpose' }],
  outputs: [
    { id: 'o1', name: 'charged', field: 'charged' },
    { id: 'o2', name: 'amount', field: 'amount' },
  ],
  rules: [{ _id: 'r1', i1: "'purchase'", o1: 'true', o2: '795' }],
};

function graph(tables: number): DecisionGraphType {
  const nodes = [
    { id: 'in', type: 'inputNode', name: 'Request', position: { x: 0, y: 0 } },
    ...Array.from({ length: tables }, (_, i) => ({
      id: `tbl${i}`,
      type: 'decisionTableNode',
      name: `Rules ${i}`,
      position: { x: 100 * (i + 1), y: 0 },
      content: TABLE,
    })),
    { id: 'out', type: 'outputNode', name: 'Response', position: { x: 400, y: 0 } },
  ];
  return {
    nodes: nodes as DecisionGraphType['nodes'],
    edges: [
      { id: 'e1', sourceId: 'in', targetId: tables ? 'tbl0' : 'out' },
      ...(tables ? [{ id: 'e2', sourceId: 'tbl0', targetId: 'out' }] : []),
    ] as DecisionGraphType['edges'],
  };
}

describe('findSimpleTable', () => {
  it('returns the single decisionTableNode', () => {
    const res = findSimpleTable(graph(1));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.nodeId).toBe('tbl0');
      expect(res.table.hitPolicy).toBe('first');
      expect(res.table.rules).toHaveLength(1);
    }
  });

  it("reports 'none' when no table node exists", () => {
    expect(findSimpleTable(graph(0))).toEqual({ ok: false, reason: 'none' });
  });

  it("reports 'multiple' when more than one table node exists", () => {
    expect(findSimpleTable(graph(2))).toEqual({ ok: false, reason: 'multiple' });
  });

  it('handles a null graph', () => {
    expect(findSimpleTable(null)).toEqual({ ok: false, reason: 'none' });
  });
});

describe('patchTableContent', () => {
  it("replaces only the target node's content", () => {
    const g = graph(1);
    const updated: DecisionTableType = {
      ...TABLE,
      rules: [...TABLE.rules, { _id: 'r2', i1: "'rateTermRefi'", o1: 'true', o2: '795' }],
    };
    const next = patchTableContent(g, 'tbl0', updated);

    expect(next.nodes.find((n) => n.id === 'tbl0')?.content).toEqual(updated);
    // Everything else is untouched — same references for other nodes/edges.
    expect(next.nodes.find((n) => n.id === 'in')).toBe(g.nodes.find((n) => n.id === 'in'));
    expect(next.nodes.find((n) => n.id === 'out')).toBe(g.nodes.find((n) => n.id === 'out'));
    expect(next.edges).toBe(g.edges);
    // The input graph is not mutated.
    expect(g.nodes.find((n) => n.id === 'tbl0')?.content).toEqual(TABLE);
  });
});
