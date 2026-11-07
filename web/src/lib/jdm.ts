import type { DecisionGraphType, DecisionTableType } from '@gorules/jdm-editor';

/** "Simple" editing owns a rule that is exactly one decision table —
 *  the surrounding graph (input/output wiring) is boilerplate the
 *  simple editor must preserve, not expose. */
export type SimpleTable =
  | { ok: true; nodeId: string; table: DecisionTableType }
  | { ok: false; reason: 'none' | 'multiple' };

export function findSimpleTable(graph: DecisionGraphType | null): SimpleTable {
  const tables = (graph?.nodes ?? []).filter((n) => n.type === 'decisionTableNode');
  if (tables.length === 0) return { ok: false, reason: 'none' };
  if (tables.length > 1) return { ok: false, reason: 'multiple' };
  return { ok: true, nodeId: tables[0].id, table: tables[0].content as DecisionTableType };
}

/** New graph with one node's content replaced; other nodes/edges shared. */
export function patchTableContent(
  graph: DecisionGraphType,
  nodeId: string,
  content: DecisionTableType,
): DecisionGraphType {
  return {
    ...graph,
    nodes: (graph.nodes ?? []).map((n) => (n.id === nodeId ? { ...n, content } : n)),
  };
}
