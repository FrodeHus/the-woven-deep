import { describe, expect, it, vi } from 'vitest';
import { loadContentSummary } from '../src/api.js';
import { CONTENT_KIND_IDS, type ContentKind } from '@woven-deep/content';
import { contentPack } from './content-pack-fixture.js';

function fetcher(kinds: readonly ContentKind[]) {
  const hash = 'c'.repeat(64);
  const pack = contentPack(hash, kinds);
  return vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: hash, entries: pack.entries.length })))
    .mockResolvedValueOnce(new Response(JSON.stringify(pack)));
}

describe('content summary counts', () => {
  it('counts every published content kind', async () => {
    const request = fetcher(CONTENT_KIND_IDS);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts).toEqual({
      monster: 1, item: 1, spell: 1, trap: 1, 'loot-table': 1, balance: 1, vault: 1, condition: 1,
      'identification-pool': 1,
    });
  });

  it('reports zero vaults when the pack contains none', async () => {
    const request = fetcher(['monster', 'item']);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts.vault).toBe(0);
  });

  it('rejects unsupported content before counting it', async () => {
    const hash = 'c'.repeat(64);
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok', contentHash: hash, entries: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, hash, entries: [] })));
    await expect(loadContentSummary(request as typeof fetch)).rejects.toThrow(/unsupported content schema version 1/i);
  });
});
