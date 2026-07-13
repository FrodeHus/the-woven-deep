import type { AttributeName, BaseAttributes } from './actor-model.js';
import type { BalanceContentEntry } from '@woven-deep/content';

export const DERIVED_STAT_NAMES = [
  'maxHealth',
  'meleeAccuracy',
  'meleeDamageBonus',
  'rangedAccuracy',
  'defense',
  'search',
  'disarm',
] as const;

export type DerivedStatName = typeof DERIVED_STAT_NAMES[number];
export type DerivedStatModifier = Readonly<Partial<Record<DerivedStatName, number>>>;
export type DerivedStatFormula = Readonly<Partial<Record<'base' | AttributeName, number>>>;

export interface ActorDerivationInput {
  readonly attributes: BaseAttributes;
  readonly formulas: BalanceContentEntry['formulas'];
  readonly equipmentModifiers: readonly DerivedStatModifier[];
  readonly conditionModifiers: readonly DerivedStatModifier[];
}

export type DerivedActorStats = Readonly<Record<DerivedStatName, number>>;

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
  for (const [attribute, value] of Object.entries(input.attributes)) safeInteger(attribute, value);
  const result = Object.fromEntries(DERIVED_STAT_NAMES.map((statName) => {
    const formula = input.formulas[statName] as DerivedStatFormula | undefined;
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
    for (const [sourceIndex, modifier] of [...input.equipmentModifiers, ...input.conditionModifiers].entries()) {
      for (const key of Object.keys(modifier)) {
        if (!DERIVED_NAMES.has(key as DerivedStatName)) throw new TypeError(`modifier ${sourceIndex} contains unknown stat ${key}`);
      }
      const amount = modifier[statName];
      if (amount !== undefined) value = checkedAdd(statName, value, safeInteger(`${statName} modifier`, amount));
    }
    return [statName, value];
  })) as Record<DerivedStatName, number>;
  return Object.freeze(result);
}
