import { describe, expect, it } from 'vitest';
import { canonicalEvent, chainHash } from '../../src/db/audit.js';

describe('audit chain', () => {
  it('canonical form is key-order-stable', () => {
    const a = canonicalEvent({
      occurredAt: 't',
      actorSub: 's',
      action: 'x',
      detail: { b: 1, a: 2, nested: { y: 1, x: 2 } },
    });
    const b = canonicalEvent({
      occurredAt: 't',
      actorSub: 's',
      action: 'x',
      detail: { a: 2, nested: { x: 2, y: 1 }, b: 1 },
    });
    expect(a).toBe(b);
  });

  it('chain hash links prev', () => {
    const h1 = chainHash('', 'c1');
    const h2 = chainHash(h1, 'c2');
    expect(h2).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash('other', 'c2')).not.toBe(h2);
  });
});
