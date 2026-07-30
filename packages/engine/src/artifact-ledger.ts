import type { OpaqueId } from './model.js';
import type { FallenHeroStandingSnapshot } from './population-model.js';
import type { LifetimeState } from './run-records-model.js';
import { compareCodeUnits } from './stable-json.js';

export type ArtifactStintOutcome =
  'died-with' | 'recovered' | 'escaped-with' | 'reclaimed-by-the-deep';

export interface ArtifactStint {
  readonly heroName: string;
  readonly recordId: OpaqueId;
  readonly outcome: ArtifactStintOutcome;
  readonly depth: number;
}

export interface ArtifactLedgerEntry {
  readonly artifactId: OpaqueId;
  readonly status: 'undiscovered' | 'lost';
  readonly holderRecordId: OpaqueId | null; // non-null iff status === 'lost'
  readonly provenance: readonly ArtifactStint[];
}

export type ArtifactLedger = readonly ArtifactLedgerEntry[]; // sorted by artifactId

export interface ArtifactDeltas {
  readonly recordId: OpaqueId; // idempotence key
  readonly stints: readonly Readonly<{
    artifactId: OpaqueId;
    stint: ArtifactStint;
    newStatus: 'undiscovered' | 'lost';
    holderRecordId: OpaqueId | null;
  }>[];
}

/** The zeroed `ArtifactLedger` a fresh profile with no artifact history sees yet. */
export function emptyArtifactLedger(): ArtifactLedger {
  return [];
}

/**
 * Ids that a player has not yet secured: absent from the ledger entirely, or present with
 * status `undiscovered`. Excludes anything currently `lost` (held by a fallen champion).
 * Sorted for determinism.
 */
export function undiscoveredArtifactIds(
  ledger: ArtifactLedger,
  allArtifactIds: ReadonlySet<OpaqueId>,
): readonly OpaqueId[] {
  const lostIds = new Set(
    ledger.filter((entry) => entry.status === 'lost').map((entry) => entry.artifactId),
  );
  const result: OpaqueId[] = [];
  for (const artifactId of allArtifactIds) {
    if (!lostIds.has(artifactId)) {
      result.push(artifactId);
    }
  }
  return result.sort(compareCodeUnits);
}

function assertSafeDepth(depth: number, label: string): void {
  if (!Number.isSafeInteger(depth)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

/**
 * Pure fold of a batch of artifact deltas onto the ledger: unknown artifact ids create new
 * entries, known ids are updated in place with the stint appended to provenance. Idempotence
 * (never applying the same `recordId`'s deltas twice) is the repository's contract (Task 4),
 * not enforced here.
 */
export function applyArtifactDeltas(
  ledger: ArtifactLedger,
  deltas: ArtifactDeltas,
): ArtifactLedger {
  const byId = new Map(ledger.map((entry) => [entry.artifactId, entry]));

  for (const change of deltas.stints) {
    assertSafeDepth(change.stint.depth, `artifact stint depth for ${change.artifactId}`);
    const existing = byId.get(change.artifactId);
    const provenance = existing ? [...existing.provenance, change.stint] : [change.stint];
    byId.set(change.artifactId, {
      artifactId: change.artifactId,
      status: change.newStatus,
      holderRecordId: change.holderRecordId,
      provenance,
    });
  }

  return [...byId.values()].sort((left, right) =>
    compareCodeUnits(left.artifactId, right.artifactId),
  );
}

/**
 * Flips every `lost` entry whose holder has fallen out of the Hall standings, or whose holder's
 * champion record has been conquered, back to `undiscovered`, recording a `reclaimed-by-the-deep`
 * stint at depth 0. Idempotent: a flipped entry has `holderRecordId: null` and can never match
 * the flip condition again on a subsequent call. Callers (Task 4) must apply this run's deltas
 * BEFORE reconciling, so a conquered champion who was also just looted by the conquering run
 * never has its stale holder observed here.
 */
export function reconcileArtifactLedger(
  input: Readonly<{
    ledger: ArtifactLedger;
    standings: readonly FallenHeroStandingSnapshot[];
    lifetime: LifetimeState;
  }>,
): ArtifactLedger {
  const { ledger, standings, lifetime } = input;
  const standingRecordIds = new Set(standings.map((standing) => standing.hallRecordId));
  const conqueredRecordIds = new Set(lifetime.conqueredChampionRecordIds);

  const reconciled = ledger.map((entry) => {
    if (entry.status !== 'lost' || entry.holderRecordId === null) {
      return entry;
    }
    const holderRecordId = entry.holderRecordId;
    const evicted = !standingRecordIds.has(holderRecordId);
    const conquered = conqueredRecordIds.has(holderRecordId);
    if (!evicted && !conquered) {
      return entry;
    }

    const lastStint = entry.provenance[entry.provenance.length - 1];
    if (lastStint === undefined) {
      throw new RangeError(`lost artifact ${entry.artifactId} has no provenance`);
    }
    const reclaimedStint: ArtifactStint = {
      heroName: lastStint.heroName,
      recordId: holderRecordId,
      outcome: 'reclaimed-by-the-deep',
      depth: 0,
    };

    return {
      artifactId: entry.artifactId,
      status: 'undiscovered' as const,
      holderRecordId: null,
      provenance: [...entry.provenance, reclaimedStint],
    };
  });

  return [...reconciled].sort((left, right) => compareCodeUnits(left.artifactId, right.artifactId));
}
