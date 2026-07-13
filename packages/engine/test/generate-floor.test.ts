import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  analyzeConnectivity,
  createClassicTheme,
  generateFloor,
  generateTopology,
  stableJson,
  type GenerateFloorRequest,
} from '../src/index.js';

const ambient = { color: [19, 23, 31] as const, strength: 7 };
let vaults: VaultContentEntry[];

beforeAll(async () => {
  const pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  vaults = pack.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
});

function request(): GenerateFloorRequest {
  const width = 80; const height = 25;
  return {
    floorId: 'floor.generated-01', floorSeed: [1, 2, 3, 4], depth: 3, width, height,
    theme: createClassicTheme(width, height, { ambient }), vaults,
    requiredVaultId: 'vault.lampwright-cache',
  };
}

describe('full floor generation', () => {
  it('publishes exact stable floor and report bytes with a required authored vault', () => {
    const input = request();
    const before = stableJson(input);
    const first = generateFloor(input);
    const second = generateFloor(input);
    expect(stableJson(first)).toBe(stableJson(second));
    expect(stableJson(input)).toBe(before);
    expect(first.floor.generatorVersion).toBe(2);
    expect(first.floor.ambient).toEqual(ambient);
    expect(first.floor.entities).toEqual([]);
    expect(first.floor.knowledge.exploredWords.every((word) => word === 0)).toBe(true);
    expect(first.floor.vaults.map((vault) => vault.vaultId)).toContain('vault.lampwright-cache');
    expect(first.floor.vaults.map((vault) => vault.placementId)).toEqual(
      [...first.floor.vaults.map((vault) => vault.placementId)].sort());
    expect(first.floor.placementSlots.map((slot) => slot.slotId)).toEqual(
      [...first.floor.placementSlots.map((slot) => slot.slotId)].sort());
    expect(first.floor.lights.map((light) => light.lightId)).toEqual(
      [...first.floor.lights.map((light) => light.lightId)].sort());
    expect(first.floor.tiles[first.floor.stairUp!.y * first.floor.width + first.floor.stairUp!.x]).toBe(4);
    expect(first.floor.tiles[first.floor.stairDown!.y * first.floor.width + first.floor.stairDown!.x]).toBe(5);
    expect(analyzeConnectivity({ width: first.floor.width, height: first.floor.height, tiles: first.floor.tiles,
      start: first.floor.stairUp!, target: first.floor.stairDown! }).connected).toBe(true);
    expect(Object.keys(first.floor)).not.toContain('report');
    expect(Object.keys(first.floor)).not.toContain('rooms');
    expect(Object.keys(first.floor)).not.toContain('corridors');
    const expected = readFileSync(new URL('./fixtures/generated-floor-seed-1.json', import.meta.url), 'utf8').trimEnd();
    expect(stableJson(first.floor)).toBe(expected);
  });

  it('shares retry attempts with vault rejection and falls back without optional vault state', () => {
    const base = request();
    const rejected = generateTopology({
      ...base, attemptLimit: 1,
      topologyFactory: () => ({ ok: false, code: 'topology.empty' }),
    });
    const generated = generateFloor({
      ...base, width: rejected.width, height: rejected.height,
      theme: createClassicTheme(rejected.width, rejected.height, { ambient }),
      attemptLimit: 3,
      topologyFactory: (_request, attempt) => ({
        ok: true,
        draft: { ...rejected, report: { ...rejected.report, fallback: false, attempt } },
      }),
    });
    expect(generated.report.fallback).toBe(true);
    expect(generated.report.attempt).toBe(null);
    expect(generated.report.rejectionCounts).toEqual({ 'vault.no-valid-placement': 3 });
    expect(generated.floor.vaults).toEqual([]);
    expect(generated.floor.placementSlots).toEqual([]);
    expect(generated.floor.lights).toEqual([]);
  });

  it('accumulates typed topology and vault rejection counts in attempt order', () => {
    const base = request();
    const rejected = generateTopology({
      ...base, attemptLimit: 1,
      topologyFactory: () => ({ ok: false, code: 'topology.empty' }),
    });
    const generated = generateFloor({
      ...base, attemptLimit: 2,
      topologyFactory: (_request, attempt) => attempt === 0
        ? { ok: false, code: 'topology.empty' }
        : { ok: true, draft: { ...rejected, report: { ...rejected.report, fallback: false, attempt } } },
    });
    expect(generated.report.rejectionCounts).toEqual({
      'topology.empty': 1, 'vault.no-valid-placement': 1,
    });
    expect(generated.report.fallback).toBe(true);
  });
});
