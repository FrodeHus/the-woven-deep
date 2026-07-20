import {
  DERIVED_STAT_NAMES,
  type CompiledContentPack,
  type ContentEntry,
  type IdentificationPoolContentEntry,
  type ItemContentEntry,
} from '@woven-deep/content';
import type { ActiveRun } from './model.js';
import { unidentifiedPresentation } from './identification.js';
import { hungerStage } from './survival.js';
import {
  effectiveEncounterProbability,
  maximumDiscoveryProtectionBonus,
} from './population-gates.js';
import {
  assertEchoTemplateBoundaries,
  normalizeFallenHero,
  retainEchoCandidates,
} from './champion.js';
import { createPopulationLoot, recordedHeirloomContentId } from './inventory.js';
import { stableJson } from './stable-json.js';
import { boundedDisplayText } from './display-text.js';

function entryMap(pack: CompiledContentPack): ReadonlyMap<string, ContentEntry> {
  return new Map(pack.entries.map((entry) => [entry.id, entry]));
}

function itemDefinition(
  entries: ReadonlyMap<string, ContentEntry>,
  contentId: string,
): ItemContentEntry {
  const definition = entries.get(contentId);
  if (!definition || definition.kind !== 'item') {
    throw new Error(`content-bound validation: item ${contentId} definition does not exist`);
  }
  return definition;
}

export function validateContentBoundRun(run: ActiveRun, pack: CompiledContentPack): void {
  if (run.contentHash !== pack.hash) {
    throw new Error(
      `content-bound validation: content hash ${pack.hash} does not match run ${run.contentHash}`,
    );
  }
  const entries = entryMap(pack);
  const actors = new Map(run.actors.map((actor) => [actor.actorId, actor]));
  const expectedEncounterIds = pack.entries
    .filter((entry) => entry.kind === 'encounter')
    .map((entry) => entry.id)
    .sort();
  const actualEncounterIds = run.encounterDecisions.map((decision) => decision.encounterId);
  if (
    actualEncounterIds.length !== expectedEncounterIds.length ||
    actualEncounterIds.some((encounterId, index) => encounterId !== expectedEncounterIds[index])
  ) {
    throw new Error(
      'content-bound validation: every encounter requires exactly one current encounter decision',
    );
  }
  for (const decision of run.encounterDecisions) {
    const encounter = entries.get(decision.encounterId);
    if (!encounter || encounter.kind !== 'encounter') {
      throw new Error(
        `content-bound validation: encounter decision ${decision.encounterId} definition does not exist`,
      );
    }
    const expectedProbability = effectiveEncounterProbability(encounter, decision.protectionBonus);
    const instanceCount = run.populations.filter(
      (population) =>
        population.model !== 'champion' &&
        population.model !== 'echo' &&
        population.encounterId === decision.encounterId,
    ).length;
    if (
      decision.baseProbability !== encounter.runAppearanceChance ||
      decision.protectionBonus > maximumDiscoveryProtectionBonus(encounter) ||
      decision.effectiveProbability !== expectedProbability ||
      decision.instancesCreated !== instanceCount ||
      decision.instancesCreated > encounter.maximumInstancesPerRun
    ) {
      throw new Error(
        `content-bound validation: encounter decision ${decision.encounterId} does not match its definition`,
      );
    }
  }
  for (const population of run.populations) {
    if (population.model === 'champion' || population.model === 'echo') {
      const template = entries.get(population.encounterId);
      if (!template || template.kind !== 'fallen-champion-template') {
        throw new Error(
          `content-bound validation: fallen-hero population ${population.populationId} template does not exist`,
        );
      }
      const standing = run.fallenHeroStandings.find(
        (entry) => entry.hallRecordId === population.hallRecordId,
      );
      if (!standing || standing.rank !== population.rank) {
        throw new Error(
          `content-bound validation: fallen-hero population ${population.populationId} has no matching standing`,
        );
      }
      const actor = actors.get(population.actorId);
      const normalized =
        actor && normalizeFallenHero({ standing, template, content: pack, role: population.model });
      if (
        !actor ||
        actor.contentId !== normalized?.monsterId ||
        actor.maxHealth !== normalized.health ||
        actor.populationPresentation?.name !== normalized.displayName ||
        actor.populationPresentation.glyph !== normalized.glyph ||
        actor.populationPresentation.color !== normalized.color ||
        population.equipmentContentIds.length !== normalized.equipmentContentIds.length ||
        population.equipmentContentIds.some(
          (id, index) => id !== normalized.equipmentContentIds[index],
        ) ||
        population.abilityIds.length !== normalized.abilityIds.length ||
        population.abilityIds.some((id, index) => id !== normalized.abilityIds[index])
      ) {
        throw new Error(
          `content-bound validation: fallen-hero population ${population.populationId} is not normalized`,
        );
      }
      continue;
    }
    const encounter = entries.get(population.encounterId);
    if (!encounter || encounter.kind !== 'encounter' || encounter.model !== population.model) {
      throw new Error(
        `content-bound validation: population ${population.populationId} does not match encounter ${population.encounterId}`,
      );
    }
    const floor = run.floors.find((entry) => entry.floorId === population.floorId)!;
    // A permanent (town) merchant is placed at depth 0, not through ordinary depth-eligible
    // population placement -- its authored minDepth/maxDepth instead describes the dungeon-depth
    // band its own stock projection widens against (see materializeMerchant/restockMerchant), so
    // the floor-depth-range check below does not apply to it.
    const permanentMerchant = encounter.model === 'merchant' && encounter.definition.permanent;
    if (
      !permanentMerchant &&
      (floor.depth < encounter.minDepth || floor.depth > encounter.maxDepth)
    ) {
      throw new Error(
        `content-bound validation: population ${population.populationId} is outside encounter depth range`,
      );
    }
    const memberActors = [...population.livingMemberIds, ...population.formerMemberIds]
      .map((actorId) => actors.get(actorId))
      .filter((actor) => actor !== undefined);
    if (population.model === 'individual' && encounter.model === 'individual') {
      if (
        memberActors.length !==
          population.livingMemberIds.length + population.formerMemberIds.length ||
        memberActors.length < encounter.definition.minimumQuantity ||
        memberActors.length > encounter.definition.maximumQuantity ||
        memberActors.some(
          (actor) =>
            actor.contentId !== encounter.definition.monsterId || actor.populationRoleId !== null,
        )
      ) {
        throw new Error(
          `content-bound validation: individual population ${population.populationId} has invalid authored quantity or membership`,
        );
      }
    } else if (population.model === 'group' && encounter.model === 'group') {
      const roles = new Map(encounter.definition.roles.map((role) => [role.roleId, role]));
      const memberIds = [...population.livingMemberIds, ...population.formerMemberIds].sort();
      const membershipIds = population.roleMembership
        .map((membership) => membership.actorId)
        .sort();
      if (
        membershipIds.length !== memberIds.length ||
        membershipIds.some((actorId, index) => actorId !== memberIds[index])
      ) {
        throw new Error(
          `content-bound validation: group population ${population.populationId} role membership is not bidirectional`,
        );
      }
      for (const membership of population.roleMembership) {
        const member = actors.get(membership.actorId);
        const role = roles.get(membership.roleId);
        if (!member || !role || role.monsterId !== member.contentId) {
          throw new Error(
            `content-bound validation: group population ${population.populationId} role ${membership.roleId} is invalid`,
          );
        }
      }
      for (const role of encounter.definition.roles) {
        const quantity = population.roleMembership.filter(
          (membership) => membership.roleId === role.roleId,
        ).length;
        if (quantity < role.minimumQuantity || quantity > role.maximumQuantity) {
          throw new Error(
            `content-bound validation: group population ${population.populationId} role ${role.roleId} quantity is invalid`,
          );
        }
      }
      if (
        population.leaderActorId !== null &&
        population.roleMembership.find(
          (membership) => membership.actorId === population.leaderActorId,
        )?.roleId !== encounter.definition.leaderRoleId
      ) {
        throw new Error(
          `content-bound validation: group population ${population.populationId} leader has the wrong role`,
        );
      }
      const timedFrenzy =
        population.leaderResponseApplied && encounter.definition.leaderDeathResponse === 'frenzy';
      if (timedFrenzy !== (population.leaderResponseExpiresAt !== null)) {
        throw new Error(
          `content-bound validation: group population ${population.populationId} leader response expiry is invalid`,
        );
      }
    } else if (population.model === 'swarm' && encounter.model === 'swarm') {
      const memberIds = [...population.livingMemberIds, ...population.formerMemberIds];
      const source = actors.get(population.sourceActorId);
      if (
        memberActors.length !== memberIds.length ||
        memberIds.filter((id) => id === population.sourceActorId).length !== 1 ||
        source?.contentId !== encounter.definition.sourceMonsterId ||
        source.populationRoleId !== null
      ) {
        throw new Error(
          `content-bound validation: swarm population ${population.populationId} source uses the wrong monster`,
        );
      }
      const roles = new Map(
        encounter.definition.spawnRoles.map((role) => [role.roleId, role.monsterId]),
      );
      for (const member of memberActors) {
        if (member.actorId === population.sourceActorId) continue;
        if (
          member.populationRoleId === null ||
          roles.get(member.populationRoleId) !== member.contentId
        ) {
          throw new Error(
            `content-bound validation: swarm population ${population.populationId} member role is invalid`,
          );
        }
      }
      const livingChildren = population.livingMemberIds.filter(
        (actorId) => actorId !== population.sourceActorId,
      ).length;
      const livingFloorSwarmActors = run.actors.filter(
        (actor) =>
          actor.floorId === population.floorId &&
          actor.health > 0 &&
          run.populations.some(
            (candidate) =>
              candidate.model === 'swarm' && candidate.populationId === actor.populationId,
          ),
      ).length;
      if (
        population.spawnedCount !== memberIds.length - 1 ||
        livingChildren > encounter.definition.maximumLivingChildren ||
        population.livingMemberIds.length > encounter.definition.maximumLivingMembers ||
        population.peakLivingSize < population.livingMemberIds.length ||
        population.peakLivingSize > encounter.definition.maximumLivingMembers ||
        livingFloorSwarmActors > encounter.definition.maximumFloorActors
      ) {
        throw new Error(
          `content-bound validation: swarm population ${population.populationId} exceeds authored caps or counts`,
        );
      }
    } else if (population.model === 'boss' && encounter.model === 'boss') {
      const memberIds = [...population.livingMemberIds, ...population.formerMemberIds];
      if (
        memberIds.length !== 1 ||
        memberIds[0] !== population.actorId ||
        actors.get(population.actorId)?.contentId !== encounter.definition.monsterId ||
        actors.get(population.actorId)?.populationRoleId !== null
      ) {
        throw new Error(
          `content-bound validation: boss population ${population.populationId} uses the wrong monster`,
        );
      }
      const phaseIds = encounter.definition.phases.map((phase) => phase.phaseId);
      if (
        population.crossedPhaseIds.some((phaseId, index) => phaseId !== phaseIds[index]) ||
        population.currentPhaseId !== (population.crossedPhaseIds.at(-1) ?? null)
      ) {
        throw new Error(
          `content-bound validation: boss population ${population.populationId} phase history is invalid`,
        );
      }
      const rewardPrefix = `item.reward.${population.populationId}.`;
      const actualRewards = run.items.filter((item) => item.itemId.startsWith(rewardPrefix));
      if (!population.rewardCreated) {
        if (population.rewardReceipt !== null || actualRewards.length > 0) {
          throw new Error(
            `content-bound validation: boss reward ${population.populationId} exists without reward state`,
          );
        }
      } else {
        if (population.rewardReceipt === null) {
          throw new Error(
            `content-bound validation: boss reward ${population.populationId} has no deterministic receipt`,
          );
        }
        const actor = actors.get(population.actorId)!;
        const { unique, receipt: expectedReceipt } = createPopulationLoot({
          content: pack,
          state: run,
          tableId: encounter.definition.enhancedLootTableId,
          itemIdPrefix: `${rewardPrefix}loot`,
          floorId: population.floorId,
          x: actor.x,
          y: actor.y,
          uniqueContentId: encounter.definition.uniqueItemId,
          uniqueItemId: `${rewardPrefix}unique`,
          lootState: population.rewardReceipt.lootStateBefore,
          dryRun: true,
        });
        const guaranteed = run.items.filter((item) => item.itemId === unique!.itemId);
        if (
          stableJson(population.rewardReceipt) !== stableJson(expectedReceipt) ||
          guaranteed.length !== 1 ||
          guaranteed[0]!.contentId !== encounter.definition.uniqueItemId ||
          guaranteed[0]!.quantity !== 1 ||
          expectedReceipt.items.filter(
            (item) => item.contentId === encounter.definition.uniqueItemId,
          ).length !== 1
        ) {
          throw new Error(
            `content-bound validation: boss reward ${population.populationId} does not match its deterministic policy`,
          );
        }
      }
    } else if (population.model === 'merchant' && encounter.model === 'merchant') {
      const npc = entries.get(population.npcId);
      const faction = entries.get(population.factionId);
      const actor = actors.get(population.actorId);
      if (
        !npc ||
        npc.kind !== 'npc' ||
        encounter.definition.npcId !== npc.id ||
        npc.factionId !== population.factionId
      ) {
        throw new Error(
          `content-bound validation: merchant population ${population.populationId} NPC does not exist`,
        );
      }
      if (!faction || faction.kind !== 'npc-faction') {
        throw new Error(
          `content-bound validation: merchant population ${population.populationId} faction does not exist`,
        );
      }
      const merchantDecision = run.encounterDecisions.find(
        (decision) => decision.encounterId === population.encounterId,
      );
      if (
        merchantDecision?.encountered === true &&
        !run.reputations.some((entry) => entry.factionId === population.factionId)
      ) {
        throw new Error(
          `content-bound validation: merchant population ${population.populationId} faction reputation was never materialized`,
        );
      }
      if (actor && (actor.contentId !== npc.id || actor.populationId !== population.populationId)) {
        throw new Error(
          `content-bound validation: merchant population ${population.populationId} actor does not match its NPC`,
        );
      }
      if (encounter.definition.permanent) {
        // A permanent (town) merchant never departs: it carries no lifetime, no departure
        // deadline, and no warning thresholds -- materialized directly by `createNewRun`, not
        // through population placement, and re-stocked in place by `restockMerchant`.
        if (
          population.departureAt !== null ||
          population.rolledLifetime !== 0 ||
          population.emittedWarningThresholds.length > 0
        ) {
          throw new Error(
            `content-bound validation: permanent merchant population ${population.populationId} carries lifecycle-departure state`,
          );
        }
      } else {
        // Content validation (packages/content schema.ts) guarantees a non-permanent merchant
        // declares all three lifetime fields, so asserting them here is safe given the guard above.
        const minimumLifetime = encounter.definition.minimumLifetime!;
        const maximumLifetime = encounter.definition.maximumLifetime!;
        if (
          population.rolledLifetime < minimumLifetime ||
          population.rolledLifetime > maximumLifetime
        ) {
          throw new Error(
            `content-bound validation: merchant population ${population.populationId} lifetime is invalid`,
          );
        }
        const authoredWarnings = new Set(encounter.definition.departureWarningThresholds!);
        // A non-permanent merchant (guarded above) always carries a numeric departureAt; `null`
        // is reserved for permanent merchants, handled separately above.
        const departureAt = population.departureAt!;
        if (
          population.emittedWarningThresholds.some(
            (threshold) =>
              !authoredWarnings.has(threshold) || departureAt - run.worldTime > threshold,
          )
        ) {
          throw new Error(
            `content-bound validation: merchant population ${population.populationId} warnings are invalid`,
          );
        }
      }
      const authoredServices = new Map(
        encounter.definition.services.map((service) => [service.serviceId, service]),
      );
      const savedServiceIds = new Set(population.services.map((service) => service.serviceId));
      if (
        population.services.length !== authoredServices.size ||
        savedServiceIds.size !== population.services.length ||
        encounter.definition.services.some((service) => !savedServiceIds.has(service.serviceId))
      ) {
        throw new Error(
          `content-bound validation: merchant population ${population.populationId} service state does not match authored offers`,
        );
      }
      for (const service of population.services) {
        const authored = authoredServices.get(service.serviceId);
        if (
          !authored ||
          service.basePrice !== authored.basePrice ||
          service.remainingUses > authored.maximumUses ||
          service.tierIds.length !== authored.tierIds.length ||
          service.tierIds.some((tierId, index) => tierId !== authored.tierIds[index])
        ) {
          throw new Error(
            `content-bound validation: merchant population ${population.populationId} service ${service.serviceId} is invalid`,
          );
        }
      }
    }
  }
  const championTemplate = pack.entries.find((entry) => entry.kind === 'fallen-champion-template');
  const expectedHeirlooms = new Map<string, Readonly<Record<string, unknown>>>();
  if (run.fallenHeroStandings.length > 0 && !championTemplate) {
    throw new Error('content-bound validation: fallen-hero standings require a Champion template');
  }
  if (championTemplate) {
    try {
      assertEchoTemplateBoundaries(championTemplate, pack);
    } catch (error) {
      throw new Error(`content-bound validation: ${(error as Error).message}`);
    }
    const retainedEchoes = run.fallenHeroDecisions.filter(
      (decision) => decision.role === 'echo' && decision.retained,
    );
    const echoStandings = run.fallenHeroStandings.slice(1);
    const echoDecisions = run.fallenHeroDecisions.filter((decision) => decision.role === 'echo');
    const expectedEchoIds = retainEchoCandidates({
      candidates: echoStandings,
      rolls: echoDecisions.map((decision) => decision.gateRoll!),
      chance: championTemplate.echoAppearanceChance,
      maximum: championTemplate.maximumEchoesPerRun,
    });
    const retainedEchoIds = retainedEchoes.map((decision) => decision.hallRecordId).sort();
    const sortedExpectedEchoIds = [...expectedEchoIds].sort();
    if (
      retainedEchoes.length > championTemplate.maximumEchoesPerRun ||
      retainedEchoIds.length !== sortedExpectedEchoIds.length ||
      retainedEchoes.some(
        (decision) => decision.gateRoll! / 0x1_0000_0000 >= championTemplate.echoAppearanceChance,
      ) ||
      retainedEchoIds.some((recordId, index) => recordId !== sortedExpectedEchoIds[index])
    ) {
      throw new Error(
        'content-bound validation: retained Echo decisions do not match the Champion template',
      );
    }
    for (const decision of run.fallenHeroDecisions) {
      const matching = run.populations.filter(
        (population) =>
          (population.model === 'champion' || population.model === 'echo') &&
          population.hallRecordId === decision.hallRecordId,
      );
      const matchedDefeated =
        matching[0]?.model === 'champion' || matching[0]?.model === 'echo'
          ? matching[0].defeated
          : false;
      if (
        matching.length > 1 ||
        matching.some((population) => population.model !== decision.role) ||
        (matching.length === 1 && !decision.retained) ||
        decision.defeated !== matchedDefeated
      ) {
        throw new Error(
          `content-bound validation: fallen-hero decision ${decision.hallRecordId} disagrees with its population`,
        );
      }
      if (decision.role === 'champion') {
        const conquered = run.conqueredChampionRecordIds.includes(decision.hallRecordId);
        if (decision.retained === conquered) {
          throw new Error(
            `content-bound validation: Champion decision ${decision.hallRecordId} disagrees with conquered state`,
          );
        }
      }
      if (matching[0]?.model === 'champion' && matching[0].rewardCreated) {
        const standing = run.fallenHeroStandings.find(
          (entry) => entry.hallRecordId === decision.hallRecordId,
        )!;
        const expectedContentId = recordedHeirloomContentId({
          content: pack,
          snapshot: standing.heirloom,
          equippedItemContentIds: standing.equippedItemContentIds,
          fallbackItemId: championTemplate.fallbackItemId,
        });
        const rewardId = `item.heirloom.${matching[0].populationId}`;
        const reward = run.items.find((item) => item.itemId === rewardId);
        const fallback = expectedContentId !== standing.heirloom.contentId;
        const expectedDefinition = entries.get(expectedContentId);
        const expectedMetadata = {
          displayName: boundedDisplayText(
            fallback && expectedDefinition?.kind === 'item'
              ? expectedDefinition.name
              : standing.heirloom.displayName,
          ),
          glyph:
            fallback && expectedDefinition?.kind === 'item'
              ? expectedDefinition.glyph
              : standing.heirloom.glyph,
          color:
            fallback && expectedDefinition?.kind === 'item'
              ? expectedDefinition.color
              : standing.heirloom.color,
          originatingHallRecordId: standing.hallRecordId,
          originatingRank: 1,
          sourceItemId: standing.heirloom.sourceItemId,
        };
        expectedHeirlooms.set(rewardId, expectedMetadata);
        if (
          !reward ||
          reward.contentId !== expectedContentId ||
          reward.quantity !== 1 ||
          reward.condition !== (fallback ? 100 : standing.heirloom.condition) ||
          reward.charges !== (fallback ? null : standing.heirloom.charges) ||
          reward.fuel !==
            (fallback && expectedDefinition?.kind === 'item'
              ? (expectedDefinition.light?.fuelCapacity ?? null)
              : standing.heirloom.fuel) ||
          stableJson(reward.enchantment) !==
            stableJson(fallback ? null : standing.heirloom.enchantment) ||
          stableJson(reward.heirloom) !== stableJson(expectedMetadata)
        ) {
          throw new Error(`content-bound validation: Champion reward ${rewardId} is invalid`);
        }
      }
    }
  }
  for (const item of run.items) {
    if (item.heirloom === undefined) continue;
    const expected = expectedHeirlooms.get(item.itemId);
    if (!expected || item.quantity !== 1 || stableJson(item.heirloom) !== stableJson(expected)) {
      throw new Error(
        `content-bound validation: heirloom provenance on item ${item.itemId} is invalid`,
      );
    }
  }
  const unidentifiedItems = pack.entries.filter(
    (entry): entry is ItemContentEntry =>
      entry.kind === 'item' && entry.identification.mode !== 'known',
  );
  const mappedContentIds = Object.keys(run.identification.appearanceByContentId).sort();
  const expectedContentIds = unidentifiedItems.map((entry) => entry.id).sort();
  if (
    mappedContentIds.length !== expectedContentIds.length ||
    mappedContentIds.some((contentId, index) => contentId !== expectedContentIds[index])
  ) {
    throw new Error(
      'content-bound validation: identification map does not match unidentified item definitions',
    );
  }
  const assignedAppearances = new Set<string>();
  for (const item of unidentifiedItems) {
    const appearanceId = run.identification.appearanceByContentId[item.id];
    const pool = pack.entries.find(
      (entry): entry is IdentificationPoolContentEntry =>
        entry.kind === 'identification-pool' && entry.id === item.identification.poolId,
    );
    if (!appearanceId || !pool) {
      throw new Error(
        `content-bound validation: identification map appearance for ${item.id} is invalid`,
      );
    }
    try {
      unidentifiedPresentation({ content: pack, appearanceId });
    } catch {
      throw new Error(
        `content-bound validation: identification map appearance for ${item.id} is invalid`,
      );
    }
    const groupKey = `${pool.id}:${appearanceId}`;
    if (assignedAppearances.has(groupKey)) {
      throw new Error(
        `content-bound validation: identification map for ${pool.id} does not use unique names`,
      );
    }
    assignedAppearances.add(groupKey);
  }
  const allocatedAppearances = new Set(
    unidentifiedItems
      .filter((item) => item.identification.mode === 'shuffled')
      .map((item) => run.identification.appearanceByContentId[item.id]!),
  );
  for (const appearanceId of run.identification.knownAppearanceIds) {
    if (!allocatedAppearances.has(appearanceId)) {
      throw new Error(
        `content-bound validation: known appearance ${appearanceId} was not allocated`,
      );
    }
  }
  const balances = pack.entries.filter((entry) => entry.kind === 'balance');
  if (balances.length !== 1)
    throw new Error(
      `content-bound validation: expected one balance definition; found ${balances.length}`,
    );
  const balance = balances[0]!;
  for (const reputation of run.reputations) {
    const faction = entries.get(reputation.factionId);
    if (!faction || faction.kind !== 'npc-faction') {
      throw new Error(
        `content-bound validation: reputation faction ${reputation.factionId} does not exist`,
      );
    }
    if (
      reputation.value < faction.minimumReputation ||
      reputation.value > faction.maximumReputation
    ) {
      throw new Error(
        `content-bound validation: reputation for ${reputation.factionId} is outside authored bounds`,
      );
    }
  }
  if (run.survival.hungerReserve > balance.hungerMaximum) {
    throw new Error(
      `content-bound validation: hunger reserve exceeds maximum ${balance.hungerMaximum}`,
    );
  }
  const expectedStage = hungerStage({
    reserve: run.survival.hungerReserve,
    thresholds: balance.hungerThresholds,
  });
  if (run.survival.hungerStage !== expectedStage) {
    throw new Error(
      `content-bound validation: hunger stage ${run.survival.hungerStage} does not match ${expectedStage}`,
    );
  }
  if ((expectedStage === 'starving') !== (run.survival.nextStarvationAt !== null)) {
    throw new Error(
      'content-bound validation: starvation deadline must exist exactly while starving',
    );
  }
  for (const item of run.items) {
    const definition = itemDefinition(entries, item.contentId);
    if (
      !Number.isSafeInteger(item.quantity) ||
      item.quantity <= 0 ||
      item.quantity > definition.stackLimit
    ) {
      throw new RangeError(
        `content-bound validation: item ${item.itemId} quantity exceeds stack limit ${definition.stackLimit}`,
      );
    }
    if (item.location.type === 'equipped') {
      if (!definition.equipment || !definition.equipment.slots.includes(item.location.slot)) {
        throw new Error(
          `content-bound validation: item ${item.itemId} cannot use equipment slot ${item.location.slot}`,
        );
      }
    }
    if (definition.light === null && (item.fuel !== null || item.enabled !== null)) {
      throw new Error(
        `content-bound validation: non-light item ${item.itemId} cannot store fuel or enabled state`,
      );
    }
    if (
      definition.light !== null &&
      (item.fuel === null || item.enabled === null || item.fuel > definition.light.fuelCapacity)
    ) {
      throw new Error(`content-bound validation: light item ${item.itemId} has invalid fuel state`);
    }
    for (const name of Object.keys(item.enchantment?.modifiers ?? {})) {
      if (!(DERIVED_STAT_NAMES as readonly string[]).includes(name)) {
        throw new Error(
          `content-bound validation: item ${item.itemId} enchantment modifier ${name} is unknown`,
        );
      }
    }
  }
  for (const entry of pack.entries) {
    if (entry.kind !== 'item' || !entry.equipment) continue;
    const equipment = entry.equipment;
    if (equipment.handedness === 'one-handed' && equipment.reservedSlots.length > 0) {
      throw new Error(
        `content-bound validation: item ${entry.id} one-handed handedness cannot reserve slots`,
      );
    }
    if (
      equipment.handedness === 'two-handed' &&
      (!equipment.slots.includes('main-hand') || !equipment.reservedSlots.includes('off-hand'))
    ) {
      throw new Error(
        `content-bound validation: item ${entry.id} two-handed handedness requires main-hand and off-hand reserved slots`,
      );
    }
    if (
      equipment.handedness === 'none' &&
      (equipment.slots.some((slot) => slot === 'main-hand' || slot === 'off-hand') ||
        equipment.reservedSlots.length > 0)
    ) {
      throw new Error(
        `content-bound validation: item ${entry.id} non-handed equipment cannot use reserved slots`,
      );
    }
  }
  for (const actor of run.actors) {
    const claimed = new Map<string, string>();
    for (const [slot, itemId] of Object.entries(actor.equipment)) {
      if (itemId === null) continue;
      const item = run.items.find((candidate) => candidate.itemId === itemId);
      if (!item)
        throw new Error(`content-bound validation: equipped item ${itemId} does not exist`);
      const equipment = itemDefinition(entries, item.contentId).equipment;
      if (!equipment) throw new Error(`content-bound validation: item ${itemId} is not equipment`);
      for (const occupied of [slot, ...equipment.reservedSlots]) {
        const existing = claimed.get(occupied);
        if (existing && existing !== item.itemId) {
          throw new Error(
            `content-bound validation: equipment items ${existing} and ${item.itemId} overlap slot ${occupied}`,
          );
        }
        claimed.set(occupied, item.itemId);
      }
    }
    if (actor.playerControlled || actor.behaviorId === null) continue;
    const definition = entries.get(actor.contentId);
    if (!definition || (definition.kind !== 'monster' && definition.kind !== 'npc')) {
      throw new Error(
        `content-bound validation: actor ${actor.actorId} template ${actor.contentId} does not exist`,
      );
    }
  }
  for (const actor of run.actors) {
    for (const condition of actor.conditions) {
      if (entries.get(condition.conditionId)?.kind !== 'condition') {
        throw new Error(
          `content-bound validation: condition ${condition.conditionId} definition does not exist`,
        );
      }
    }
  }
  for (const feature of run.features) {
    if (feature.contentId === null || feature.type !== 'trap') continue;
    if (entries.get(feature.contentId)?.kind !== 'trap') {
      throw new Error(
        `content-bound validation: trap ${feature.featureId} definition ${feature.contentId} does not exist`,
      );
    }
  }
}
