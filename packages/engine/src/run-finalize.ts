import type {
  AchievementContentEntry,
  AchievementCriteria,
  CompiledContentPack,
  EncounterContentEntry,
  FallenChampionTemplateContentEntry,
} from '@woven-deep/content';
import { heroActor } from './actor-model.js';
import type {
  AchievementGrantedEvent,
  ActiveRun,
  DomainEvent,
  OpaqueId,
  RunFinalizedEvent,
} from './model.js';
import { evaluateDiscoveryProtection } from './population-gates.js';
import type { FallenHeroRunDecision } from './population-model.js';
import {
  deriveHallRecordId,
  encodeRunSeed,
  type AchievementGrant,
  type FallenHeroBuildSnapshot,
  type HallRecord,
  type LifetimeDeltas,
  type LifetimeState,
} from './run-records-model.js';
import { scoreRun } from './score-run.js';
import {
  equippedInstanceSnapshots,
  heldArtifactIds,
  selectRecordHeirloom,
} from './heirloom-selection.js';
import type { ArtifactDeltas, ArtifactStint } from './artifact-ledger.js';
import { fallenChampionTemplate } from './haunt-need.js';
import { heroHoldsFragment, tabletFragmentIds } from './final-chamber-fragments.js';
import { compareCodeUnits } from './stable-json.js';

/**
 * The spells a hero is remembered for: their known spells, capped at the champion template's
 * `abilityLimit`, chosen by HIGHEST weave cost first with the spell id as a deterministic
 * tie-break.
 *
 * Cost is the proxy for signature: the expensive spells are the ones a hero was known for, not the
 * cantrip they threw every turn. The tie-break is not cosmetic -- standings are ordered by
 * `compareHallRecords` downstream and normalized into a haunt's ability list, so the selection
 * needs a total order or two runs of the same hero could raise different champions.
 *
 * A spell the current pack no longer defines is dropped here rather than carried into the record:
 * `normalizeFallenHero` would filter it anyway, and a record that names content nothing can resolve
 * is a record that lies about what the haunt will do.
 *
 * Cost decides WHICH spells; the recorded list is then sorted by id, exactly like
 * `equippedItemContentIds` beside it. That is not cosmetic: the save schema validates both
 * `standing.signatureAbilityIds` and a placed haunt's `abilityIds` as unique and STRICTLY
 * INCREASING, so a list left in cost order would make every run carrying that standing unsavable.
 *
 * Consumes no randomness.
 */
function signatureAbilityIds(
  run: ActiveRun,
  content: CompiledContentPack,
  template: FallenChampionTemplateContentEntry,
): readonly OpaqueId[] {
  // Deduplicated first: `hero.knownSpellIds` is the only list on this path with no ordered-id
  // validation behind it, and a duplicate would sail through recording and only throw on the first
  // save of a LATER run that loaded the resulting standing.
  return [...new Set(run.hero.knownSpellIds ?? [])]
    .flatMap((spellId) => {
      const spell = content.entries.find((entry) => entry.id === spellId);
      return spell?.kind === 'spell' ? [{ spellId, weaveCost: spell.weaveCost }] : [];
    })
    .sort(
      (left, right) =>
        right.weaveCost - left.weaveCost || compareCodeUnits(left.spellId, right.spellId),
    )
    .slice(0, template.abilityLimit)
    .map((candidate) => candidate.spellId)
    .sort(compareCodeUnits);
}

function buildSnapshot(
  run: ActiveRun,
  content: CompiledContentPack,
  template: FallenChampionTemplateContentEntry,
): FallenHeroBuildSnapshot {
  const hero = heroActor(run);
  const equippedContentIds = run.items
    .filter((item) => item.location.type === 'equipped' && item.location.actorId === hero.actorId)
    .map((item) => item.contentId);
  return {
    attributes: hero.attributes,
    equippedItemContentIds: [...new Set(equippedContentIds)].sort(compareCodeUnits),
    signatureAbilityIds: signatureAbilityIds(run, content, template),
  };
}

function isFirstDefeat(
  decision: FallenHeroRunDecision,
  role: FallenHeroRunDecision['role'],
  lifetime: LifetimeState,
): boolean {
  return (
    decision.role === role &&
    decision.retained &&
    decision.defeated &&
    (role !== 'champion' || !lifetime.conqueredChampionRecordIds.includes(decision.hallRecordId))
  );
}

function criterionMet(
  criteria: AchievementCriteria,
  ctx: Readonly<{
    decisions: readonly FallenHeroRunDecision[];
    lifetime: LifetimeState;
    deepestDepth: number;
    completionType: HallRecord['completionType'];
    defeatedBossMonsterIds: readonly OpaqueId[];
  }>,
): boolean {
  switch (criteria.type) {
    case 'defeat-boss':
      return ctx.defeatedBossMonsterIds.includes(criteria.monsterId);
    case 'defeat-fallen-hero':
      return ctx.decisions.some((decision) => isFirstDefeat(decision, criteria.role, ctx.lifetime));
    case 'reach-depth':
      return ctx.deepestDepth >= criteria.depth;
    case 'complete-ending':
      return ctx.completionType === criteria.ending;
  }
}

function achievementGrants(
  input: Readonly<{ run: ActiveRun; lifetime: LifetimeState; content: CompiledContentPack }>,
): readonly AchievementGrant[] {
  const { run, lifetime, content } = input;
  const completionType = run.conclusion!.completionType;
  const ctx = {
    decisions: run.fallenHeroDecisions,
    lifetime,
    deepestDepth: run.metrics.deepestDepth,
    completionType,
    defeatedBossMonsterIds: run.metrics.defeatedBossMonsterIds,
  };
  return content.entries
    .filter(
      (entry): entry is AchievementContentEntry =>
        entry.kind === 'achievement' &&
        !lifetime.grantedAchievementIds.includes(entry.id) &&
        criterionMet(entry.criteria, ctx),
    )
    .map((entry): AchievementGrant => ({ achievementId: entry.id, name: entry.name }))
    .sort((left, right) => compareCodeUnits(left.achievementId, right.achievementId));
}

function newlyConqueredChampionRecordIds(
  decisions: readonly FallenHeroRunDecision[],
  lifetime: LifetimeState,
): readonly OpaqueId[] {
  const conquered = decisions
    .filter((decision) => isFirstDefeat(decision, 'champion', lifetime))
    .map((decision) => decision.hallRecordId);
  return [...new Set(conquered)].sort(compareCodeUnits);
}

/**
 * The Ancient Tablet fragments this run banks: every fragment the hero is holding as the run
 * concludes — including a death grip — minus what lifetime already has. Sorted.
 *
 * Held at the end is the whole test. A fragment sold, dropped, or never picked up banks nothing:
 * the Deep remembers what the hero carried out of it, or died with.
 *
 * A SURRENDERED run banks nothing at all, whatever the hero was holding. That is the entire cost of
 * surrendering: the score bonus is zero, the same as an ordinary death, so the only thing the choice
 * actually forfeits is progress toward the one ending that requires fragments. The hero gave
 * themselves to the Deep, and the Deep keeps what they carried.
 */
function newlyCollectedFragmentIds(
  run: ActiveRun,
  content: CompiledContentPack,
  lifetime: LifetimeState,
): readonly OpaqueId[] {
  if (run.conclusion!.completionType === 'surrendered') return [];

  return tabletFragmentIds(content)
    .filter(
      (fragmentId) =>
        heroHoldsFragment(run, fragmentId) && !lifetime.collectedFragmentIds.includes(fragmentId),
    )
    .sort(compareCodeUnits);
}

/**
 * One run's effect on the artifact ledger: the artifact that became this record's heirloom is
 * `lost` to the record (`died-with` for a death or a surrender, `escaped-with` when the hero left
 * the Deep any other way),
 * and every other artifact the hero was carrying is recycled straight back into circulation
 * (`reclaimed-by-the-deep`, `undiscovered`, no holder). Sorted by artifact id; empty when the hero
 * held none. The stint depth is where the run ended, which is where the artifact came to rest.
 */
function artifactStints(
  input: Readonly<{
    heldArtifactIds: readonly OpaqueId[];
    chosenArtifactId: OpaqueId | null;
    heroName: string;
    recordId: OpaqueId;
    completionType: HallRecord['completionType'];
    depth: number;
  }>,
): ArtifactDeltas['stints'] {
  // `escaped-with` means the hero LEFT the Deep still holding it. A surrendered hero did not leave,
  // so their carried artifact reads exactly as a death does.
  const carriedOutcome: ArtifactStint['outcome'] =
    input.completionType === 'died' || input.completionType === 'surrendered'
      ? 'died-with'
      : 'escaped-with';
  return [...input.heldArtifactIds].sort(compareCodeUnits).map((artifactId) => {
    const carried = artifactId === input.chosenArtifactId;
    return {
      artifactId,
      stint: {
        heroName: input.heroName,
        recordId: input.recordId,
        outcome: carried ? carriedOutcome : 'reclaimed-by-the-deep',
        depth: input.depth,
      },
      newStatus: carried ? ('lost' as const) : ('undiscovered' as const),
      holderRecordId: carried ? input.recordId : null,
    };
  });
}

/**
 * Finalizes a concluded run exactly once into its Hall record, achievement grants, and lifetime
 * deltas. Pure and clock-free: identical inputs produce byte-identical outputs, only the
 * `run-records` stream may advance (one heirloom roll at most — the artifact-priority roll and the
 * ordinary roll are alternatives, never both), and the returned `LifetimeDeltas`/`ArtifactDeltas`
 * are plain data for the host to apply — the engine never touches the repository. Hosts must apply
 * the lifetime deltas FIRST and the artifact deltas second, so the ledger's reconcile pass sees
 * this run's conquests. Event IDs derive from the deterministic record ID, so replaying
 * finalization reproduces identical events.
 */
export function finalizeRun(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    lifetime: LifetimeState;
  }>,
): Readonly<{
  run: ActiveRun;
  record: HallRecord;
  deltas: LifetimeDeltas;
  artifactDeltas: ArtifactDeltas;
  events: readonly DomainEvent[];
}> {
  const { run, content, lifetime } = input;
  if (run.conclusion === null) throw new Error('finalizeRun requires a concluded run');
  if (run.conclusion.finalized) throw new Error('internal invariant: run is already finalized');
  const conclusion = run.conclusion;

  const recordId = deriveHallRecordId(run.runSeed, run.contentHash);
  const heldArtifacts = heldArtifactIds(run, content);
  const template = fallenChampionTemplate(content);
  const heirloom = selectRecordHeirloom({
    run,
    content,
    template,
    recordId,
    heldArtifactIds: heldArtifacts,
  });
  const score = scoreRun({ run, content });

  const record: HallRecord = {
    recordId,
    heroName: run.hero.name,
    classTags: [...run.hero.classTags].sort(),
    completionType: conclusion.completionType,
    cause: conclusion.cause,
    deepestDepth: run.metrics.deepestDepth,
    score,
    metrics: run.metrics,
    reputations: run.reputations,
    heirloom: heirloom.snapshot,
    // Equipped-only, captured at conclusion: this is what the hero's haunt will guard. Falls back
    // to the selected heirloom (which is the template's fallback relic in this case) so the field
    // is never empty and the champion drop always has something to materialize.
    deathInventory: (() => {
      const captured = equippedInstanceSnapshots({ run, content, recordId });
      return captured.length === 0 ? [heirloom.snapshot] : captured;
    })(),
    build: buildSnapshot(run, content, template),
    runSeed: encodeRunSeed(run.runSeed),
    contentHash: run.contentHash,
  };

  const grants = achievementGrants({ run, lifetime, content });
  const encounters = content.entries.filter(
    (entry): entry is EncounterContentEntry => entry.kind === 'encounter',
  );
  const deltas: LifetimeDeltas = {
    recordId,
    newlyConqueredChampionRecordIds: newlyConqueredChampionRecordIds(
      run.fallenHeroDecisions,
      lifetime,
    ),
    newlyCollectedFragmentIds: newlyCollectedFragmentIds(run, content, lifetime),
    achievementGrants: grants,
    discoveryProtectionUpdates: [
      ...evaluateDiscoveryProtection({ decisions: run.encounterDecisions, encounters }),
    ].sort((left, right) => compareCodeUnits(left.encounterId, right.encounterId)),
    metrics: run.metrics,
  };

  const artifactDeltas: ArtifactDeltas = {
    recordId,
    stints: artifactStints({
      heldArtifactIds: heldArtifacts,
      chosenArtifactId: heldArtifacts.length === 0 ? null : heirloom.snapshot.contentId,
      heroName: run.hero.name,
      recordId,
      completionType: conclusion.completionType,
      depth: conclusion.cause.depth,
    }),
  };

  const eventId = `event.finalize.${recordId}`;
  const finalizedEvent: RunFinalizedEvent = {
    type: 'run.finalized',
    eventId,
    recordId,
    completionType: conclusion.completionType,
    scoreTotal: score.total,
  };
  const grantEvents = grants.map((grant): AchievementGrantedEvent => ({
    type: 'achievement.granted',
    eventId,
    achievementId: grant.achievementId,
    name: grant.name,
  }));

  return {
    run: {
      ...run,
      rng: { ...run.rng, 'run-records': heirloom.nextRunRecordsState },
      conclusion: { ...conclusion, finalized: true },
    },
    record,
    deltas,
    artifactDeltas,
    events: [finalizedEvent, ...grantEvents],
  };
}
