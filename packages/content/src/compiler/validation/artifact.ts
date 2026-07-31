import type { ContentEntry, ItemContentEntry } from '../../model.js';
import { DERIVED_STAT_NAMES } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { issue, referencedKindIssue, type LocatedContentEntry } from './shared.js';

// Every way an item is destroyed by being spent on something else. `effect.item.consume` erases
// the instance outright; `effect.fuel.transfer` pours it into a lamp; a tag that some light lists
// in `fuelTags`, or the lockpick tag the lock roll consumes, makes it spendable without any effect
// of its own. An artifact is a singleton in circulation and may take none of these routes out.
const LOCKPICK_CONSUMPTION_TAG = 'lockpick';
const CONSUMING_EFFECT_IDS: readonly string[] = ['effect.item.consume', 'effect.fuel.transfer'];

function consumptionTags(entries: readonly LocatedContentEntry[]): ReadonlySet<string> {
  const tags = new Set<string>([LOCKPICK_CONSUMPTION_TAG]);
  for (const { entry } of entries) {
    if (entry.kind !== 'item' || entry.light === null) continue;
    for (const tag of entry.light.fuelTags) tags.add(tag);
  }
  return tags;
}

function artifactItemIssues(
  file: string,
  item: ItemContentEntry,
  byId: ReadonlyMap<string, ContentEntry>,
  consumable: ReadonlySet<string>,
): ContentCompileIssue[] {
  const artifact = item.artifact;
  if (!artifact) return [];
  const path = `$.entries.${item.id}.artifact`;
  const issues: ContentCompileIssue[] = [];

  if (item.rarity !== 'legendary') {
    issues.push(issue(file, `${path}`, 'artifact items must be rarity legendary'));
  }
  if (item.stackLimit !== 1) {
    issues.push(
      issue(file, `$.entries.${item.id}.stackLimit`, 'artifact items must have stackLimit 1'),
    );
  }
  if (item.identification.mode !== 'known') {
    issues.push(
      issue(
        file,
        `$.entries.${item.id}.identification.mode`,
        'artifact items must use identification mode known',
      ),
    );
  }
  if (artifact.signature === null && item.combat === null) {
    issues.push(
      issue(file, path, 'artifact items require a signature spell, a combat block, or both'),
    );
  }

  const inextinguishable = artifact.light?.inextinguishable === true;
  const drawbackKeys = Object.keys(artifact.drawbackModifiers);
  if (drawbackKeys.length === 0 && !inextinguishable) {
    issues.push(
      issue(
        file,
        `${path}.drawbackModifiers`,
        'artifact items require at least one drawback modifier unless light.inextinguishable is true',
      ),
    );
  }
  for (const [key, value] of Object.entries(artifact.drawbackModifiers)) {
    if (!(DERIVED_STAT_NAMES as readonly string[]).includes(key)) {
      issues.push(
        issue(file, `${path}.drawbackModifiers.${key}`, `unknown derived-stat key ${key}`),
      );
    }
    if (value >= 0) {
      issues.push(
        issue(
          file,
          `${path}.drawbackModifiers.${key}`,
          'artifact drawback modifiers must be negative',
        ),
      );
    }
  }

  if (artifact.signature) {
    issues.push(
      ...referencedKindIssue(
        file,
        `${path}.signature.spellId`,
        artifact.signature.spellId,
        'spell',
        byId,
      ),
    );
    if (artifact.signature.rechargePerFloor > artifact.signature.charges) {
      issues.push(
        issue(file, `${path}.signature.rechargePerFloor`, 'rechargePerFloor cannot exceed charges'),
      );
    }
  }

  if (artifact.light !== null && item.light === null) {
    issues.push(
      issue(file, `${path}.light`, 'artifact light requires a non-null item light block'),
    );
  }

  // An artifact is a singleton that must survive its bearer: the champion recovery path only
  // materializes the recorded content ID when the item is heirloom eligible and equippable, and a
  // light artifact only survives that path intact when its fuel never matters.
  if (item.heirloomEligible !== true) {
    issues.push(
      issue(
        file,
        `$.entries.${item.id}.heirloomEligible`,
        'artifact items must be heirloomEligible so a fallen hero can pass them on',
      ),
    );
  }
  if (item.equipment === null) {
    issues.push(
      issue(
        file,
        `$.entries.${item.id}.equipment`,
        'artifact items require a non-null equipment block so a fallen hero can pass them on',
      ),
    );
  }
  for (const effect of item.effects) {
    if (!CONSUMING_EFFECT_IDS.includes(effect.effectId)) continue;
    issues.push(
      issue(
        file,
        `$.entries.${item.id}.effects`,
        `artifact items must not carry self-consuming effects: ${effect.effectId} can erase an artifact from circulation`,
      ),
    );
  }
  for (const tag of item.tags) {
    if (!consumable.has(tag)) continue;
    issues.push(
      issue(
        file,
        `$.entries.${item.id}.tags`,
        `artifact items must not carry a consumption tag: ${tag} lets an artifact be spent as fuel or as a lockpick`,
      ),
    );
  }
  if (item.light !== null && artifact.light?.fuelless !== true) {
    issues.push(
      issue(
        file,
        `${path}.light`,
        'artifact items with a light block must be fuelless so recovery cannot degrade them',
      ),
    );
  }

  return issues;
}

export function artifactIssues(
  locatedEntries: readonly LocatedContentEntry[],
  byId: ReadonlyMap<string, ContentEntry>,
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const consumable = consumptionTags(locatedEntries);
  for (const { entry, file } of locatedEntries) {
    if (entry.kind !== 'item') continue;
    issues.push(...artifactItemIssues(file, entry, byId, consumable));
  }
  return issues;
}

export function artifactItemIdSet(
  locatedEntries: readonly LocatedContentEntry[],
): ReadonlySet<string> {
  return new Set(
    locatedEntries
      .filter(({ entry }) => entry.kind === 'item' && entry.artifact !== null)
      .map(({ entry }) => entry.id),
  );
}
