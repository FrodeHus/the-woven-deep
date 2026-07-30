import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack, VaultContentEntry } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  balanceEntry,
  createClassicTheme,
  createDemoRun,
  generateFloor,
  milestoneBossVaultId,
  placeFloorPopulations,
} from '../src/index.js';

let content: CompiledContentPack;
let vaults: VaultContentEntry[];

beforeAll(async () => {
  content = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  vaults = content.entries.filter((entry): entry is VaultContentEntry => entry.kind === 'vault');
});

const ambient = { color: [19, 23, 31] as const, strength: 7 };

function bossDecision(encounterId: string) {
  return {
    encounterId,
    baseProbability: 1,
    protectionBonus: 0,
    effectiveProbability: 1,
    eligible: true,
    reachedEligibleDepth: false,
    encountered: false,
    instancesCreated: 0,
  };
}

function generateAt(depth: number, requiredVaultId: string | undefined) {
  const width = 80;
  const height = 25;
  return generateFloor({
    floorId: `floor.depth-${depth}`,
    floorSeed: [depth, 2, 3, 4],
    depth,
    width,
    height,
    theme: createClassicTheme(width, height, { ambient }),
    vaults,
    doorTilePercent: balanceEntry(content).generation.doorTilePercent,
    ...(requiredVaultId === undefined ? {} : { requiredVaultId }),
  });
}

describe('milestone boss guarantee', () => {
  it('guarantees the Ashfather in its arena at depth 5', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 5);
    expect(requiredVaultId).toBe('vault.ashfather-arena');
    const generated = generateAt(5, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain('vault.ashfather-arena');
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.ashfather')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.ashfather');
    expect(bosses).toHaveLength(1);
  });

  it('guarantees the Tide-Sovereign in its arena at depth 10', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 10);
    expect(requiredVaultId).toBe('vault.tide-sovereign-arena');
    const generated = generateAt(10, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain(
      'vault.tide-sovereign-arena',
    );
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.tide-sovereign')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.tide-sovereign',
    );
    expect(bosses).toHaveLength(1);
  });

  it('guarantees the Heart-Herald in its arena at depth 15', () => {
    const requiredVaultId = milestoneBossVaultId(vaults, 15);
    expect(requiredVaultId).toBe('vault.heart-herald-arena');
    const generated = generateAt(15, requiredVaultId);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).toContain(
      'vault.heart-herald-arena',
    );
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.heart-herald')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter(
      (actor) => actor.contentId === 'monster.heart-herald',
    );
    expect(bosses).toHaveLength(1);
  });

  it('forces no milestone vault and no boss at a non-milestone depth (6)', () => {
    expect(milestoneBossVaultId(vaults, 6)).toBeUndefined();
    const generated = generateAt(6, undefined);
    expect(generated.floor.vaults.map((vault) => vault.vaultId)).not.toContain(
      'vault.ashfather-arena',
    );
    const base = createDemoRun();
    const run = { ...base, encounterDecisions: [bossDecision('encounter.ashfather')] };
    const result = placeFloorPopulations({ run, floor: generated.floor, content });
    const bosses = result.state.actors.filter((actor) => actor.contentId === 'monster.ashfather');
    expect(bosses).toHaveLength(0);
  });
});
