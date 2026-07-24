import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, LootTableContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { createFloorLootFromTable } from '../src/index.js';

let content: CompiledContentPack;

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function allowedContentIds(tableId: string): ReadonlySet<string> {
  const table = content.entries.find(
    (entry): entry is LootTableContentEntry => entry.kind === 'loot-table' && entry.id === tableId,
  )!;
  return new Set(
    table.choices.map((choice) => choice.contentId).filter((id): id is string => id !== null),
  );
}

describe('deep family loot resolves', () => {
  it.each(['loot-table.the-bound', 'loot-table.echo-wrought'])(
    'resolves %s to items drawn only from its choices',
    (tableId) => {
      const allowed = allowedContentIds(tableId);
      const result = createFloorLootFromTable({
        content,
        tableId,
        state: [7, 11, 13, 17],
        itemIdPrefix: `item.test.${tableId}`,
        floorId: 'floor.test',
        x: 3,
        y: 4,
      });
      expect(result.items.length).toBeGreaterThan(0);
      for (const item of result.items) {
        expect(allowed.has(item.contentId)).toBe(true);
      }
    },
  );
});
