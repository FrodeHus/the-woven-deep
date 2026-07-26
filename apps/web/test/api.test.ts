import { describe, expect, it, vi } from 'vitest';
import { deleteAccount, loadContentPack, loadContentSummary } from '../src/api.js';
import { CONTENT_KIND_IDS, type ContentKind } from '@woven-deep/content';
import { contentPack } from './content-pack-fixture.js';

function fetcher(kinds: readonly ContentKind[]) {
  const hash = 'c'.repeat(64);
  const pack = contentPack(hash, kinds);
  return vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'ok', contentHash: hash, entries: pack.entries.length }),
      ),
    )
    .mockResolvedValueOnce(new Response(JSON.stringify(pack)));
}

describe('content summary counts', () => {
  it('counts every published content kind', async () => {
    const request = fetcher(CONTENT_KIND_IDS);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts).toEqual({
      monster: 1,
      npc: 0,
      'npc-faction': 0,
      item: 1,
      spell: 1,
      trap: 1,
      'loot-table': 1,
      balance: 1,
      vault: 1,
      condition: 1,
      dialogue: 0,
      'identification-pool': 1,
      encounter: 0,
      'fallen-champion-template': 0,
      achievement: 0,
      class: 0,
      background: 0,
      trait: 0,
    });
  });

  it('reports zero vaults when the pack contains none', async () => {
    const request = fetcher(['monster', 'item']);

    const summary = await loadContentSummary(request as typeof fetch);

    expect(summary.counts.vault).toBe(0);
  });

  it('rejects unsupported content before counting it', async () => {
    const hash = 'c'.repeat(64);
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ok', contentHash: hash, entries: 0 })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, hash, entries: [] })));
    await expect(loadContentSummary(request as typeof fetch)).rejects.toThrow(
      /unsupported content schema version 1/i,
    );
  });
});

describe('loadContentPack', () => {
  it('fetches and validates the guest content pack', async () => {
    const hash = 'c'.repeat(64);
    const pack = contentPack(hash, CONTENT_KIND_IDS);
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(pack)));

    const loaded = await loadContentPack(request as typeof fetch);

    expect(loaded).toEqual(pack);
    expect(request).toHaveBeenCalledWith('/api/content/guest');
  });

  it('rejects unsupported content before returning it', async () => {
    const hash = 'c'.repeat(64);
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ schemaVersion: 1, hash, entries: [] })));

    await expect(loadContentPack(request as typeof fetch)).rejects.toThrow(
      /unsupported content schema version 1/i,
    );
  });
});

describe('deleteAccount', () => {
  it('resolves when the server confirms the delete', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      deleteAccount('csrf-token', request as unknown as typeof fetch),
    ).resolves.toBeUndefined();
  });

  it('throws when the server delete fails, instead of resolving as if it succeeded', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(deleteAccount('csrf-token', request as unknown as typeof fetch)).rejects.toThrow(
      /failed to delete the account/i,
    );
  });
});
