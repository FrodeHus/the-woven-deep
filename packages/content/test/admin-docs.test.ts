import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CONDITION_TRAIT_IDS, CONTENT_KIND_IDS, MAX_ENCOUNTER_MEMBERS, MAX_LOOT_CHOICE_QUANTITY,
  MAX_LOOT_CREATED_UNITS, MAX_LOOT_TABLE_ROLLS, MAX_LOOT_WEIGHT_TOTAL, MAX_RANDOM_WEIGHT_TOTAL,
  MAX_SWARM_FLOOR_ACTORS, MAX_SWARM_LIVING_CHILDREN, MAX_SWARM_LIVING_MEMBERS,
  MAX_SWARM_SPAWN_QUANTITY,
} from '../src/index.js';
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
  contentSourceEntrySchema,
} from '../src/compiler/schema.js';
import {
  ACTION_COST_IDS,
  BEHAVIOR_PARAMETER_SCHEMAS,
  EFFECT_PARAMETER_SCHEMAS,
  LEADER_RESPONSE_PARAMETER_SCHEMAS,
  SWARM_RESPONSE_PARAMETER_SCHEMAS,
} from '../src/compiler/registries.js';

describe('server-admin content documentation', () => {
  function collectEncounterSchemaTerms(schema: unknown): string[] {
    const terms = new Set<string>();
    const visit = (value: unknown, insidePopulationEntry = false): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, insidePopulationEntry);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      const record = value as Record<string, unknown>;
      const properties = record.properties as Record<string, unknown> | undefined;
      const kind = properties?.kind as Record<string, unknown> | undefined;
      const populationEntry = insidePopulationEntry
        || kind?.const === 'encounter'
        || kind?.const === 'fallen-champion-template';
      if (populationEntry && properties) {
        for (const field of Object.keys(properties)) terms.add(field);
      }
      if (populationEntry && Array.isArray(record.enum)) {
        for (const identifier of record.enum) {
          if (typeof identifier === 'string') terms.add(identifier);
        }
      }
      for (const child of Object.values(record)) visit(child, populationEntry);
    };
    visit(z.toJSONSchema(schema as Parameters<typeof z.toJSONSchema>[0]));
    return [...terms].sort();
  }

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
      'minimumQuantity', 'maximumQuantity', 'communicationRadius', 'leaderChance',
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

  it('derives exhaustive encounter and fallen-template field coverage from the source schema', async () => {
    const reference = await readFile(resolve(
      import.meta.dirname,
      '../../../docs/server-admin/content-configuration.md',
    ), 'utf8');
    const populationReference = reference.slice(
      reference.indexOf('## Encounter entries'),
      reference.indexOf('## Item entries'),
    );
    const missing = collectEncounterSchemaTerms(contentSourceEntrySchema)
      .filter((term) => !populationReference.includes(`\`${term}\``));
    expect(missing, 'missing schema-derived admin documentation').toEqual([]);
  });

  it('documents every enforced encounter and loot allocation bound with drift-resistant values', async () => {
    const reference = await readFile(resolve(
      import.meta.dirname,
      '../../../docs/server-admin/content-configuration.md',
    ), 'utf8');
    const required = [
      'Positive safe integer validation is necessary but not sufficient',
      `Aggregate encounter selection weight: at most \`${MAX_RANDOM_WEIGHT_TOTAL}\` (\`2^32\`).`,
      `Individual or aggregate group members per encounter: at most \`${MAX_ENCOUNTER_MEMBERS}\`.`,
      `Aggregate swarm \`spawnRoles[].weight\`: at most \`${MAX_RANDOM_WEIGHT_TOTAL}\` (\`2^32\`).`,
      `Swarm children created per spawn: at most \`${MAX_SWARM_SPAWN_QUANTITY}\`.`,
      `Living children per swarm: at most \`${MAX_SWARM_LIVING_CHILDREN}\`.`,
      `Living members per swarm encounter: at most \`${MAX_SWARM_LIVING_MEMBERS}\`.`,
      `Living swarm actors per floor: at most \`${MAX_SWARM_FLOOR_ACTORS}\`.`,
      `Aggregate \`choices[].weight\` per loot table: at most \`${MAX_LOOT_WEIGHT_TOTAL}\` (\`2^32\`).`,
      `Loot-table \`rolls\`: at most \`${MAX_LOOT_TABLE_ROLLS}\`.`,
      `Each loot choice quantity: at most \`${MAX_LOOT_CHOICE_QUANTITY}\` and no greater than the direct item's \`stackLimit\`.`,
      `Recursive worst-case created loot units: at most \`${MAX_LOOT_CREATED_UNITS}\`.`,
      'Boss guaranteed-unique content is forbidden anywhere in an ordinary loot graph',
      'including another boss enhanced-loot table or an Echo loot table',
    ];
    for (const contract of required) {
      expect(reference, `missing numeric/rejection contract: ${contract}`).toContain(contract);
    }
  });
});
