import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createDemoRun,
  decodeActiveRun,
  encodeActiveRun,
  migrateActiveRun,
  SaveLoadError,
} from '../src/index.js';

const fixtureUrl = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);

describe('active-run migration', () => {
  it('migrates the checked-in v0 save to the checked-in stable v1 document', async () => {
    const [legacyJson, expectedJson] = await Promise.all([
      readFile(fixtureUrl('v0-save.json'), 'utf8'),
      readFile(fixtureUrl('v1-migrated-save.json'), 'utf8'),
    ]);

    expect(encodeActiveRun(decodeActiveRun(legacyJson))).toBe(expectedJson.trimEnd());
  });

  it('returns an already-current document idempotently', () => {
    const current = createDemoRun();

    expect(migrateActiveRun(current)).toEqual(current);
  });

  it.each([-1, 2, 999])('rejects unsupported schema version %s safely', (schemaVersion) => {
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
