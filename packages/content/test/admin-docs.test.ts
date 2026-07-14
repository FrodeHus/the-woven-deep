import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONDITION_TRAIT_IDS, CONTENT_KIND_IDS } from '../src/index.js';
import {
  damageTypes,
  encounterFormations,
  encounterModels,
  equipmentSlots,
  formationPreferences,
  leaderDeathResponses,
  swarmDestructionResponses,
  targetingIds,
  vaultPlacementKinds,
} from '../src/compiler/schema.js';
import {
  ACTION_COST_IDS,
  BEHAVIOR_PARAMETER_SCHEMAS,
  EFFECT_PARAMETER_SCHEMAS,
  LEADER_RESPONSE_PARAMETER_SCHEMAS,
  SWARM_RESPONSE_PARAMETER_SCHEMAS,
} from '../src/compiler/registries.js';

describe('server-admin content documentation', () => {
  it('documents every YAML content kind and closed registry ID', async () => {
    const reference = await readFile(resolve(
      import.meta.dirname,
      '../../../docs/server-admin/content-configuration.md',
    ), 'utf8');
    const required = [
      ...CONTENT_KIND_IDS,
      ...damageTypes,
      ...targetingIds,
      ...equipmentSlots,
      ...vaultPlacementKinds,
      ...encounterModels,
      ...encounterFormations,
      ...formationPreferences,
      ...leaderDeathResponses,
      ...swarmDestructionResponses,
      ...ACTION_COST_IDS,
      ...Object.keys(BEHAVIOR_PARAMETER_SCHEMAS),
      ...Object.keys(EFFECT_PARAMETER_SCHEMAS),
      ...Object.keys(LEADER_RESPONSE_PARAMETER_SCHEMAS),
      ...Object.keys(SWARM_RESPONSE_PARAMETER_SCHEMAS),
      ...CONDITION_TRAIT_IDS,
    ];
    for (const identifier of required) {
      expect(reference, `missing admin documentation for ${identifier}`)
        .toContain(`\`${identifier}\``);
    }
    for (const category of ['defense', 'food', 'healing', 'identification', 'light', 'offense']) {
      expect(reference, `missing foundational category documentation for ${category}`)
        .toContain(`\`${category}\``);
    }
    for (const field of [
      'runAppearanceChance', 'discoveryProtectionIncrement', 'discoveryProtectionCap',
      'maximumInstancesPerRun', 'minimumStairDistance', 'minimumObjectiveDistance',
      'maximumMemberDistance', 'allowedTerrainTags', 'requiresVaultSlot', 'failureMode',
      'minimumQuantity', 'maximumQuantity', 'communicationRadius', 'leaderProbability',
      'leaderRoleId', 'leaderDeathResponse', 'supernaturalBond', 'collapseRewards',
      'spawnInterval', 'maximumLivingChildren', 'maximumLivingMembers', 'maximumFloorActors',
      'sourceDestructionResponse', 'healthThresholdPercent', 'recoveryPerWorldTime',
      'recoveryCapPercent', 'uniqueItemId', 'enhancedLootTableId',
      'fallbackMonsterId', 'fallbackItemId', 'echoAppearanceChance', 'maximumEchoesPerRun',
      'echoHealthPercent', 'echoDamagePercent', 'echoDefensePercent', 'echoAbilityLimit',
      'echoLootTableId', 'rarityWeights', 'qualityRankBonus',
    ]) {
      expect(reference, `missing encounter field documentation for ${field}`).toContain(`\`${field}\``);
    }
  });
});
