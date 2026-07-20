import type {
  BackgroundContentEntry,
  BalanceContentEntry,
  ClassContentEntry,
  CompiledContentPack,
  DerivedStatName,
  PointBuyDefinition,
  TraitContentEntry,
} from '@woven-deep/content';
import type { BaseAttributes } from './actor-model.js';
import type { DerivedStatModifier } from './attributes.js';
import type { OpaqueId, Uint32State } from './model.js';
import type { NewRunBackpackItem, NewRunHero, NewRunHeroItem } from './new-run.js';
import { deriveSeed, rollDie } from './random.js';

export const ATTRIBUTE_ORDER = ['might', 'agility', 'vitality', 'wits', 'resolve'] as const;

export const HERO_NAME_RULES = {
  minLength: 1,
  maxLength: 24,
  pattern: /^[\p{L}\p{N} '-]+$/u,
} as const;

// Chargen draws its own deterministic random stream from the run seed, separate
// from the per-run RNG streams derived by `deriveRngStreams` (discriminators
// 1-10 in random.ts:7-18). Discriminator 11 is reserved for chargen and must
// stay distinct from those.
const CHARGEN_SEED_DISCRIMINATOR = 11;

export interface AttributeRoll {
  readonly attributes: BaseAttributes;
  readonly state: Uint32State;
}

function rollFromState(state: Uint32State): AttributeRoll {
  let cursor = state;
  const values: Record<string, number> = {};
  for (const attributeName of ATTRIBUTE_ORDER) {
    let sum = 0;
    for (let draw = 0; draw < 3; draw += 1) {
      const step = rollDie(cursor, 6);
      sum += step.value;
      cursor = step.state;
    }
    values[attributeName] = sum;
  }
  return { attributes: values as unknown as BaseAttributes, state: cursor };
}

export function rollAttributes(seed: Uint32State): AttributeRoll {
  return rollFromState(deriveSeed(seed, CHARGEN_SEED_DISCRIMINATOR));
}

export function rerollAttributes(previous: AttributeRoll): AttributeRoll {
  return rollFromState(previous.state);
}

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function checkedAdd(label: string, left: number, right: number): number {
  return safeInteger(label, left + right);
}

export function pointBuyCost(attributes: BaseAttributes, pointBuy: PointBuyDefinition): number {
  let total = 0;
  for (const attributeName of ATTRIBUTE_ORDER) {
    const value = attributes[attributeName];
    const row = pointBuy.costs.find((candidate) => candidate.value === value);
    if (!row)
      throw new Error(`point-buy cost table has no entry for ${attributeName} value ${value}`);
    total = checkedAdd('point-buy cost', total, row.cost);
  }
  return total;
}

export function pointBuyValid(attributes: BaseAttributes, balance: BalanceContentEntry): boolean {
  let cost: number;
  try {
    cost = pointBuyCost(attributes, balance.pointBuy);
  } catch {
    return false;
  }
  return cost <= balance.pointBuy.budget;
}

export interface HeroChoices {
  readonly name: string;
  readonly method: 'roll' | 'point-buy';
  readonly attributes: BaseAttributes;
  readonly classId: OpaqueId;
  readonly kitId: string;
  readonly backgroundId: OpaqueId;
  readonly traitIds: readonly OpaqueId[];
}

function normalizedName(name: string): string {
  return name.trim().normalize('NFC');
}

function requireBalance(pack: CompiledContentPack): BalanceContentEntry {
  const entry = pack.entries.find(
    (candidate): candidate is BalanceContentEntry => candidate.kind === 'balance',
  );
  if (!entry) throw new Error('content pack is missing a balance entry');
  return entry;
}

function requireClass(pack: CompiledContentPack, classId: OpaqueId): ClassContentEntry {
  const entry = pack.entries.find(
    (candidate): candidate is ClassContentEntry =>
      candidate.kind === 'class' && candidate.id === classId,
  );
  if (!entry) throw new Error(`hero choices: classId ${classId} is unknown`);
  if (!entry.playable) throw new Error(`hero choices: classId ${classId} is locked`);
  return entry;
}

function requireBackground(
  pack: CompiledContentPack,
  backgroundId: OpaqueId,
): BackgroundContentEntry {
  const entry = pack.entries.find(
    (candidate): candidate is BackgroundContentEntry =>
      candidate.kind === 'background' && candidate.id === backgroundId,
  );
  if (!entry) throw new Error(`hero choices: backgroundId ${backgroundId} is unknown`);
  return entry;
}

function requireTraits(
  pack: CompiledContentPack,
  traitIds: readonly OpaqueId[],
): readonly TraitContentEntry[] {
  if (traitIds.length > 2) throw new Error('hero choices: traitIds must contain at most 2 entries');
  const seen = new Set<OpaqueId>();
  const traits: TraitContentEntry[] = [];
  for (const traitId of traitIds) {
    if (seen.has(traitId))
      throw new Error(`hero choices: traitIds must be unique (duplicate ${traitId})`);
    seen.add(traitId);
    const entry = pack.entries.find(
      (candidate): candidate is TraitContentEntry =>
        candidate.kind === 'trait' && candidate.id === traitId,
    );
    if (!entry) throw new Error(`hero choices: traitIds contains unknown trait ${traitId}`);
    traits.push(entry);
  }
  return traits;
}

export function validateHeroChoices(
  input: Readonly<{ pack: CompiledContentPack; choices: HeroChoices }>,
): void {
  const { pack, choices } = input;
  const balance = requireBalance(pack);

  const name = normalizedName(choices.name);
  if (
    name.length < HERO_NAME_RULES.minLength ||
    name.length > HERO_NAME_RULES.maxLength ||
    !HERO_NAME_RULES.pattern.test(name)
  ) {
    throw new Error('hero choices: name is invalid after trimming and normalization');
  }

  for (const attributeName of ATTRIBUTE_ORDER) {
    const value = choices.attributes[attributeName];
    if (
      !Number.isSafeInteger(value) ||
      value < balance.attributeMinimum ||
      value > balance.attributeMaximum
    ) {
      throw new Error(`hero choices: attributes.${attributeName} is out of bounds`);
    }
  }

  if (choices.method === 'point-buy' && !pointBuyValid(choices.attributes, balance)) {
    throw new Error('hero choices: attributes exceed the point-buy budget');
  }

  const classEntry = requireClass(pack, choices.classId);
  const kit = classEntry.kits.find((candidate) => candidate.kitId === choices.kitId);
  if (!kit)
    throw new Error(`hero choices: kitId ${choices.kitId} is unknown for class ${choices.classId}`);

  requireBackground(pack, choices.backgroundId);
  requireTraits(pack, choices.traitIds);
}

function mergeModifiers(sources: readonly DerivedStatModifier[]): DerivedStatModifier {
  const result: Partial<Record<DerivedStatName, number>> = {};
  for (const source of sources) {
    for (const [statName, value] of Object.entries(source)) {
      if (value === undefined) continue;
      const key = statName as DerivedStatName;
      const current = result[key] ?? 0;
      result[key] = checkedAdd(`statModifiers.${statName}`, current, value);
    }
  }
  return Object.freeze(result);
}

export function heroFromChoices(
  input: Readonly<{ pack: CompiledContentPack; choices: HeroChoices }>,
): NewRunHero {
  validateHeroChoices(input);
  const { pack, choices } = input;

  const classEntry = requireClass(pack, choices.classId);
  const kit = classEntry.kits.find((candidate) => candidate.kitId === choices.kitId)!;
  const backgroundEntry = requireBackground(pack, choices.backgroundId);
  const traitEntries = requireTraits(pack, choices.traitIds);

  const equipped: NewRunHeroItem[] = kit.equipped.map((item) =>
    item.enabled === undefined
      ? { contentId: item.contentId, slot: item.slot }
      : { contentId: item.contentId, slot: item.slot, enabled: item.enabled },
  );

  const backpack: NewRunBackpackItem[] = [...kit.backpack, ...backgroundEntry.extraItems].map(
    (item) =>
      item.quantity === undefined
        ? { contentId: item.contentId }
        : { contentId: item.contentId, quantity: item.quantity },
  );

  const statModifiers = mergeModifiers([
    backgroundEntry.modifiers,
    ...traitEntries.map((trait) => trait.modifiers),
  ]);

  return {
    name: normalizedName(choices.name),
    attributes: choices.attributes,
    equipped,
    backpack,
    classTags: classEntry.classTags,
    statModifiers,
  };
}
