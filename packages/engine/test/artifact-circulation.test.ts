import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  advanceFallenHeroEncounters,
  createInMemoryRunRecordRepository,
  createNewRun,
  createUnknownKnowledge,
  DEFAULT_GUEST_HERO,
  emptyRunMetrics,
  finalizeRun,
  newRunRecords,
  placeFloorPopulations,
  type ActiveRun,
  type ArtifactLedger,
  type FloorSnapshot,
  type ItemInstance,
  type RunRecordRepository,
  type StoredHallRecord,
} from '../src/index.js';
import type { ChampionPopulation } from '../src/population-model.js';

/**
 * The full life of one legendary artifact across three runs: found in a deep vault, lost with the
 * hero who died holding it, guarded by the champion that hero became, recovered by the next hero,
 * and still out of circulation for the run after that. Every step goes through the production
 * paths -- `fillItemSlots` for the offer, `advanceFallenHeroEncounters` for the champion's
 * heirloom, `finalizeRun` for the deltas, and the in-memory `RunRecordRepository` for the ledger.
 */

let pack: CompiledContentPack;

const VAULT_ID = 'vault.lampwright-cache';
/** `vault.lampwright-cache` legend `r`: the optional artifact-offer slot, at local (1, 4). */
const ARTIFACT_SLOT_LOCAL = { x: 1, y: 4 } as const;
const VAULT_ORIGIN = { x: 1, y: 1 } as const;

beforeAll(async () => {
  const authored = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  // One pack for all three runs so every record's `sourceContentHash` agrees, with the offer
  // roll forced to always succeed: this test is about circulation, not about the offer's odds.
  pack = {
    ...authored,
    entries: authored.entries.map((entry) =>
      entry.kind === 'balance'
        ? { ...entry, generation: { ...entry.generation, artifactOfferPercent: 100 } }
        : entry,
    ),
  };
});

/** The authored `minDepth` band of an artifact's own item entry -- the depth its vault offer slot
 * refuses to materialize above (see `fillItemSlots`). */
function minDepthOf(artifactId: string): number {
  const entry = pack.entries.find(
    (candidate) => candidate.kind === 'item' && candidate.id === artifactId,
  );
  if (entry?.kind !== 'item') throw new Error(`pack has no item entry for ${artifactId}`);
  return entry.minDepth;
}

/**
 * A floor carrying the authored lampwright cache, with only its artifact-offer slot exposed. The
 * caller passes a depth inside the offered artifact's own band: `fillItemSlots` leaves the offer
 * slot empty on any floor shallower than that, so a fixed shallow depth would place nothing.
 */
function vaultFloor(floorId: string, depth: number): FloorSnapshot {
  const width = 13;
  const height = 11;
  const tiles = Array.from({ length: width * height }, (_, index) => {
    const x = index % width;
    const y = Math.floor(index / width);
    return x === 0 || y === 0 || x === width - 1 || y === height - 1 ? (0 as const) : (1 as const);
  });
  return {
    floorId,
    seed: [21, 22, 23, 24],
    generatorVersion: 2,
    width,
    height,
    depth,
    tiles,
    entities: [],
    themeId: 'theme.cavern',
    ambient: { color: [0, 0, 0], strength: 0 },
    knowledge: createUnknownKnowledge(tiles.length),
    lights: [],
    stairUp: { x: 1, y: 1 },
    stairDown: { x: 11, y: 9 },
    vaults: [
      {
        placementId: 'vault-placement.circulation.0',
        vaultId: VAULT_ID,
        x: VAULT_ORIGIN.x,
        y: VAULT_ORIGIN.y,
        width: 7,
        height: 6,
        rotation: 0,
        reflected: false,
        entrances: [],
      },
    ],
    placementSlots: [
      {
        slotId: 'slot.circulation.0.artifact-offer',
        vaultPlacementId: 'vault-placement.circulation.0',
        kind: 'item',
        required: false,
        tags: ['artifact', 'cache'],
        x: VAULT_ORIGIN.x + ARTIFACT_SLOT_LOCAL.x,
        y: VAULT_ORIGIN.y + ARTIFACT_SLOT_LOCAL.y,
      },
    ],
  };
}

function intoHeroBackpack(run: ActiveRun, item: ItemInstance): ActiveRun {
  return {
    ...run,
    items: run.items.map((candidate) =>
      candidate.itemId === item.itemId
        ? { ...candidate, location: { type: 'backpack' as const, actorId: run.hero.actorId } }
        : candidate,
    ),
  };
}

function died(run: ActiveRun, depth: number): ActiveRun {
  return {
    ...run,
    metrics: { ...emptyRunMetrics(), kills: 2, deepestDepth: depth, turnsElapsed: 90 },
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth, turn: 90, worldTime: 9_000 },
      concludedAtRevision: 7,
      finalized: false,
    },
  };
}

function commit(
  repository: RunRecordRepository,
  finalized: ReturnType<typeof finalizeRun>,
): StoredHallRecord {
  const stored: StoredHallRecord = {
    ...finalized.record,
    enrichment: { achievedAt: 1_700_000_000_000, portraitGlyph: '@' },
  };
  repository.appendRecord(stored);
  // Lifetime first: the ledger's reconcile reads the conquered champions this run just recorded.
  repository.applyDeltas(finalized.deltas);
  repository.applyArtifactDeltas(finalized.artifactDeltas);
  return stored;
}

function entryFor(ledger: ArtifactLedger, artifactId: string) {
  const entry = ledger.find((candidate) => candidate.artifactId === artifactId);
  if (!entry) throw new Error(`ledger has no entry for ${artifactId}`);
  return entry;
}

describe('artifact circulation across runs', () => {
  it('carries one artifact from a vault offer through a champion and back into a hero’s hands', () => {
    const repository = createInMemoryRunRecordRepository();

    // --- Run A: the artifact is found in the vault and lost with the hero who carried it. ---
    const runA = createNewRun({
      pack,
      seed: [11, 22, 33, 44],
      hero: DEFAULT_GUEST_HERO,
      records: newRunRecords(repository, pack),
    });
    const artifactId = runA.offeredArtifact;
    expect(artifactId).not.toBeNull();
    expect(runA.artifactsUndiscovered).toContain(artifactId);

    const offerDepth = minDepthOf(artifactId!);
    const floorA = vaultFloor('floor.circulation.a', offerDepth);
    const placedA = placeFloorPopulations({ run: runA, floor: floorA, content: pack });
    const offer = placedA.state.items.find((item) =>
      item.itemId.startsWith('item.artifact-offer.'),
    );
    expect(offer).toMatchObject({ contentId: artifactId, identified: true, condition: 100 });
    // The singleton claim, asserted rather than assumed: one instance, not one placement.
    expect(placedA.state.items.filter((item) => item.contentId === artifactId)).toHaveLength(1);

    const finalizedA = finalizeRun({
      run: died(intoHeroBackpack(placedA.state, offer!), offerDepth),
      content: pack,
      lifetime: repository.lifetime(),
    });
    expect(finalizedA.record.heirloom?.contentId).toBe(artifactId);
    expect(finalizedA.artifactDeltas.stints).toEqual([
      expect.objectContaining({
        artifactId,
        newStatus: 'lost',
        holderRecordId: finalizedA.record.recordId,
        stint: expect.objectContaining({ outcome: 'died-with' }),
      }),
    ]);
    const recordA = commit(repository, finalizedA);

    expect(entryFor(repository.artifactLedger(), artifactId!)).toMatchObject({
      status: 'lost',
      holderRecordId: recordA.recordId,
    });
    expect(newRunRecords(repository, pack).undiscoveredArtifactIds).not.toContain(artifactId);

    // --- Run B: the champion that hero became is guarding it. ---
    const runB = createNewRun({
      pack,
      seed: [55, 66, 77, 88],
      hero: DEFAULT_GUEST_HERO,
      records: newRunRecords(repository, pack),
    });
    expect(runB.artifactsUndiscovered).not.toContain(artifactId);
    // Non-null: the offer really rolled, and it rolled something else.
    expect(runB.offeredArtifact).not.toBeNull();
    expect(runB.offeredArtifact).not.toBe(artifactId);
    const standing = runB.fallenHeroStandings.find(
      (candidate) => candidate.hallRecordId === recordA.recordId,
    );
    expect(standing?.heirloom.contentId).toBe(artifactId);

    const championActor = {
      ...runB.actors[0]!,
      actorId: 'actor.champion',
      contentId: standing!.heirloom.contentId,
      playerControlled: false,
      health: 0,
      disposition: 'hostile' as const,
      populationId: 'population.champion',
      populationRoleId: null,
      populationPresentation: {
        name: standing!.heroName,
        glyph: '@',
        color: '#ffcc00',
        leader: false,
      },
    };
    const championPopulation: ChampionPopulation = {
      model: 'champion',
      populationId: 'population.champion',
      encounterId: 'encounter.fallen-hero',
      floorId: runB.activeFloorId,
      createdAt: 0,
      livingMemberIds: [championActor.actorId],
      formerMemberIds: [],
      actorId: championActor.actorId,
      hallRecordId: recordA.recordId,
      rank: 1,
      defeated: false,
      rewardCreated: false,
      equipmentContentIds: [],
      abilityIds: [],
    };
    const conquered = advanceFallenHeroEncounters({
      state: {
        ...runB,
        actors: [...runB.actors, championActor],
        populations: [...runB.populations, championPopulation],
        fallenHeroDecisions: runB.fallenHeroDecisions.map((decision) =>
          decision.hallRecordId === recordA.recordId
            ? { ...decision, role: 'champion' as const, retained: true }
            : decision,
        ),
      },
      content: pack,
      eventId: 'event.circulation.champion',
    });

    // The champion drops the artifact itself, not the template's fallback relic.
    const heirloom = conquered.state.items.find(
      (item) => item.itemId === 'item.heirloom.population.champion',
    );
    expect(heirloom?.contentId).toBe(artifactId);
    // Still exactly one instance: the champion hands over the relic, it does not mint a copy.
    expect(conquered.state.items.filter((item) => item.contentId === artifactId)).toHaveLength(1);
    expect(conquered.events).toContainEqual(
      expect.objectContaining({ type: 'champion.heirloom-created', fallback: false }),
    );

    const finalizedB = finalizeRun({
      run: died(intoHeroBackpack(conquered.state, heirloom!), offerDepth + 1),
      content: pack,
      lifetime: repository.lifetime(),
    });
    expect(finalizedB.deltas.newlyConqueredChampionRecordIds).toContain(recordA.recordId);
    expect(finalizedB.artifactDeltas.stints).toEqual([
      expect.objectContaining({
        artifactId,
        newStatus: 'lost',
        holderRecordId: finalizedB.record.recordId,
      }),
    ]);
    const recordB = commit(repository, finalizedB);

    // --- Run C: the artifact is still out of circulation, now held by run B's record. ---
    const ledger = entryFor(repository.artifactLedger(), artifactId!);
    expect(ledger.status).toBe('lost');
    expect(ledger.holderRecordId).toBe(recordB.recordId);
    expect(ledger.provenance.map((stint) => stint.recordId)).toEqual([
      recordA.recordId,
      recordB.recordId,
    ]);

    const runC = createNewRun({
      pack,
      seed: [99, 111, 122, 133],
      hero: DEFAULT_GUEST_HERO,
      records: newRunRecords(repository, pack),
    });
    expect(runC.artifactsUndiscovered).not.toContain(artifactId);
    expect(runC.offeredArtifact).not.toBe(artifactId);
  });
});
