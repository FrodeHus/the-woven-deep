import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  migrateV0ToV1,
  migrateV1ToV2,
  migrateActiveRun,
  SaveLoadError,
  stableJson,
} from '../src/index.js';

const fixtureUrl = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);

describe('active-run migration', () => {
  it('migrates through the checked-in stable v1 and v2 documents in order', async () => {
    const v0 = JSON.parse(await readFile(fixtureUrl('v0-save.json'), 'utf8')) as unknown;
    const v1Expected = (await readFile(fixtureUrl('v1-migrated-save.json'), 'utf8')).trimEnd();
    expect(stableJson(migrateV0ToV1(v0))).toBe(v1Expected);

    const v1 = JSON.parse(v1Expected) as unknown;
    const v2Expected = (await readFile(fixtureUrl('v2-migrated-save.json'), 'utf8')).trimEnd();
    expect(encodeActiveRun(migrateV1ToV2(v1))).toBe(v2Expected);
    expect(encodeActiveRun(decodeActiveRun(JSON.stringify(v0)))).toBe(v2Expected);
  });

  it('returns an already-current document idempotently', () => {
    const current = createDemoRun();

    expect(migrateActiveRun(current)).toEqual(current);
  });

  it('stabilizes legacy entity order without changing entity values', async () => {
    const legacy = JSON.parse(await readFile(fixtureUrl('v1-migrated-save.json'), 'utf8')) as any;
    legacy.floors[0].entities = [
      { entityId: 'entity.z', x: 3, y: 1 },
      { entityId: 'entity.a', x: 1, y: 2 },
    ];

    expect(migrateV1ToV2(legacy).floors[0]?.entities).toEqual([
      { entityId: 'entity.a', x: 1, y: 2 },
      { entityId: 'entity.z', x: 3, y: 1 },
    ]);
  });

  it.each([-1, 3, 999])('rejects unsupported schema version %s safely', (schemaVersion) => {
    try {
      migrateActiveRun({ schemaVersion });
      expect.fail('expected migration to reject the schema version');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveLoadError);
      expect(error).toMatchObject({ kind: 'unsupported_version', path: 'schemaVersion' });
    }
  });

  it('rejects incomplete v0 data instead of guessing a content binding', () => {
    try {
      migrateActiveRun({ schemaVersion: 0, seed: 1 });
      expect.fail('expected migration to reject incomplete v0 data');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveLoadError);
      expect(error).toMatchObject({ kind: 'migration_failed' });
      expect((error as SaveLoadError).path).not.toBe('$');
    }
  });
});
