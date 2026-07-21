import {
  DERIVED_STAT_NAMES,
  type BalanceContentEntry,
  type DerivedStatName,
} from '@woven-deep/content';
import type { AttributeName, BaseAttributes } from './actor-model.js';
import type { PopulationCombatModifiers } from '@woven-deep/content';

export { DERIVED_STAT_NAMES, type DerivedStatName } from '@woven-deep/content';
export type DerivedStatModifier = Readonly<Partial<Record<DerivedStatName, number>>>;
export type DerivedStatFormula = Readonly<Partial<Record<'base' | AttributeName, number>>>;

export interface ActorDerivationInput {
  readonly attributes: BaseAttributes;
  readonly formulas: BalanceContentEntry['formulas'];
  /** Base Weave regen per recovery interval, from `balance.weaveRegenAmount` -- `weaveRegen` has
   * no entry in `formulas` (unlike the other derived stats) because it's single-sourced from this
   * balance constant rather than an attribute-scaled formula. */
  readonly weaveRegenAmount: number;
  readonly equipmentModifiers: readonly DerivedStatModifier[];
  readonly conditionModifiers: readonly DerivedStatModifier[];
  readonly heroModifiers?: readonly DerivedStatModifier[];
}

export type DerivedActorStats = Readonly<Record<DerivedStatName, number>>;

export function populationDerivedStatModifier(
  modifiers: PopulationCombatModifiers,
): DerivedStatModifier {
  for (const [name, value] of Object.entries(modifiers) as [string, number][])
    safeInteger(`population ${name}`, value);
  return Object.freeze({
    meleeAccuracy: modifiers.accuracy,
    rangedAccuracy: modifiers.accuracy,
    defense: modifiers.defense,
    meleeDamageBonus: modifiers.damage,
  });
}

const ATTRIBUTE_NAMES = new Set<AttributeName>(['might', 'agility', 'vitality', 'wits', 'resolve']);
const DERIVED_NAMES = new Set<DerivedStatName>(DERIVED_STAT_NAMES);

function safeInteger(label: string, value: number): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function checkedAdd(label: string, left: number, right: number): number {
  return safeInteger(label, left + right);
}

function checkedMultiply(label: string, left: number, right: number): number {
  return safeInteger(label, left * right);
}

export function deriveActorStats(input: ActorDerivationInput): DerivedActorStats {
  for (const [attribute, value] of Object.entries(input.attributes) as [string, number][])
    safeInteger(attribute, value);
  const result = Object.fromEntries(
    DERIVED_STAT_NAMES.map((statName) => {
      const formula: DerivedStatFormula | undefined =
        statName === 'weaveRegen'
          ? { base: input.weaveRegenAmount }
          : (input.formulas[statName]);
      if (formula === undefined) throw new TypeError(`${statName} formula is required`);
      let value = 0;
      for (const [operand, coefficient] of Object.entries(formula)) {
        safeInteger(`${statName}.${operand} coefficient`, coefficient);
        if (operand === 'base') value = checkedAdd(statName, value, coefficient);
        else if (ATTRIBUTE_NAMES.has(operand as AttributeName)) {
          const attribute = safeInteger(operand, input.attributes[operand as AttributeName]);
          value = checkedAdd(statName, value, checkedMultiply(statName, coefficient, attribute));
        } else throw new TypeError(`${statName} formula contains unknown operand ${operand}`);
      }
      for (const [sourceIndex, modifier] of [
        ...input.equipmentModifiers,
        ...input.conditionModifiers,
        ...(input.heroModifiers ?? []),
      ].entries()) {
        for (const key of Object.keys(modifier)) {
          if (!DERIVED_NAMES.has(key as DerivedStatName))
            throw new TypeError(`modifier ${sourceIndex} contains unknown stat ${key}`);
        }
        const amount = modifier[statName];
        if (amount !== undefined)
          value = checkedAdd(statName, value, safeInteger(`${statName} modifier`, amount));
      }
      return [statName, value];
    }),
  ) as Record<DerivedStatName, number>;
  return Object.freeze(result);
}
