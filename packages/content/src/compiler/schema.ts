import { z } from 'zod';
import { CONTENT_SCHEMA_VERSION } from '../model.js';
import { achievementEntry } from './schema/achievement.js';
import { balanceEntry } from './schema/balance.js';
import { backgroundEntry, classEntry, traitEntry } from './schema/character.js';
import { conditionEntry } from './schema/condition.js';
import { encounterEntry } from './schema/encounter.js';
import { fallenChampionTemplateEntry } from './schema/champion.js';
import { identificationPoolEntry } from './schema/identification-pool.js';
import { itemEntry } from './schema/item.js';
import { lootTableEntry } from './schema/loot-table.js';
import { monsterEntry } from './schema/monster.js';
import { npcEntry, npcFactionEntry } from './schema/npc.js';
import { spellEntry } from './schema/spell.js';
import { trapEntry } from './schema/trap.js';
import { vaultEntry } from './schema/vault.js';

export {
  damageTypes,
  diceSchema,
  encounterFormations,
  encounterModels,
  equipmentSlots,
  formationPreferences,
  leaderDeathResponses,
  merchantServiceIds,
  slugSchema,
  stableIdSchema,
  swarmDestructionResponses,
  targetingIds,
  vaultPlacementKinds,
} from './schema/common.js';
export { TOWN_VAULT_REQUIRED_SLOT_IDS } from './schema/vault.js';

export const contentSourceEntrySchema = z.discriminatedUnion('kind', [
  monsterEntry,
  itemEntry,
  spellEntry,
  trapEntry,
  lootTableEntry,
  balanceEntry,
  vaultEntry,
  conditionEntry,
  identificationPoolEntry,
  encounterEntry,
  fallenChampionTemplateEntry,
  npcEntry,
  npcFactionEntry,
  achievementEntry,
  classEntry,
  backgroundEntry,
  traitEntry,
]);

export const contentEntrySchema = contentSourceEntrySchema.transform((entry) => {
  if (entry.kind === 'encounter')
    return {
      ...entry,
      discoveryProtectionIncrement: entry.discoveryProtectionIncrement ?? 0,
      discoveryProtectionCap: entry.discoveryProtectionCap ?? 0,
    };
  if (entry.kind !== 'vault') return entry;
  let entranceCount = 0;
  const requiredSlotIds = new Set<string>();
  for (const row of entry.layout) {
    for (const symbol of row) {
      const legend = entry.legend[symbol];
      if (legend?.entrance) entranceCount += 1;
      if (legend?.slot?.required) requiredSlotIds.add(legend.slot.id);
    }
  }
  return {
    ...entry,
    entranceCount,
    requiredSlotIds: [...requiredSlotIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  };
});

export const contentFileSchema = z.strictObject({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  entries: z.array(contentEntrySchema).min(1),
});
