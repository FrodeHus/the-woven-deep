import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory } from '../src/compiler/index.js';
import type { DialogueContentEntry, NpcContentEntry } from '../src/model.js';

describe('dialogue roster', () => {
  it('ships the travelling lampwright dialogue with cross-referenced consequences', async () => {
    const pack = await compileContentDirectory({
      rootDir: resolve(import.meta.dirname, '../../../content'),
    });
    const entries = new Map(pack.entries.map((entry) => [entry.id, entry]));

    const dialogue = entries.get('dialogue.travelling-lampwright') as
      DialogueContentEntry | undefined;
    expect(dialogue).toBeDefined();
    expect(dialogue?.kind).toBe('dialogue');
    expect(dialogue?.topics.length).toBeGreaterThanOrEqual(1);

    const revealLore = dialogue?.topics
      .map((topic) => topic.consequence)
      .find((consequence) => consequence?.kind === 'reveal-lore');
    expect(revealLore).toBeDefined();
    if (revealLore?.kind === 'reveal-lore') {
      const target = entries.get(revealLore.contentId) as { lore?: string } | undefined;
      expect(target).toBeDefined();
      expect(typeof target?.lore).toBe('string');
      expect(target?.lore?.trim().length).toBeGreaterThan(0);
    }

    const reputation = dialogue?.topics
      .map((topic) => topic.consequence)
      .find((consequence) => consequence?.kind === 'reputation');
    expect(reputation).toBeDefined();
    if (reputation?.kind === 'reputation') {
      expect(entries.get(reputation.factionId)).toMatchObject({ kind: 'npc-faction' });
    }

    const npc = entries.get('npc.travelling-lampwright') as NpcContentEntry | undefined;
    expect(npc?.dialogueId).toBe('dialogue.travelling-lampwright');
  });
});
