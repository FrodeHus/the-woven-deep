import { describe, expect, it, vi } from 'vitest';
import { loadContentSummary } from '../src/api.js';

function fetcher(entries: readonly Readonly<{ id: string; kind: string; name: string }>[]) {
  const hash = 'c'.repeat(64);
  return vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: hash, entries: entries.length })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, hash, entries })));
}

describe('content summary counts', () => {
  it('counts monster, item, and vault entries', async () => {
    const request = fetcher([
      { id: 'monster.cave-rat', kind: 'monster', name: 'Cave rat' },
      { id: 'item.brass-lantern', kind: 'item', name: 'Brass lantern' },
      { id: 'vault.lampwright-cache', kind: 'vault', name: 'Lampwright cache' },
    ]);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts).toEqual({ monster: 1, item: 1, vault: 1 });
  });

  it('reports zero vaults when the pack contains none', async () => {
    const request = fetcher([
      { id: 'monster.cave-rat', kind: 'monster', name: 'Cave rat' },
      { id: 'item.brass-lantern', kind: 'item', name: 'Brass lantern' },
    ]);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts.vault).toBe(0);
  });
});
