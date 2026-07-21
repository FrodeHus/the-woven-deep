/**
 * Shared display-label humanization: every authoring-token-to-copy conversion in the client
 * goes through this one place.
 */

/** Turns an authoring token (e.g. `fixture.standing-lamp`, `effect.heal`) into readable copy: the
 * last dot-segment, dashes to spaces, sentence-cased ("Standing lamp", "Heal"). Never touches
 * anything past that -- no pluralization, no synonym table, just the mechanical transform every
 * caller before this module hand-rolled its own (slightly different) copy of. */
export function humanize(token: string): string {
  const segment = token.split('.').at(-1) ?? token;
  const words = segment.replaceAll('-', ' ');
  if (words.length === 0) return words;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The narrow dice shape every `effect.heal`/`effect.damage` parameterization reads --
 * `DiceDefinition` (`packages/content/src/model.ts`), duck-typed here rather than imported so this
 * module stays engine/content-import-free (a pure UI-string helper). */
interface DiceParameter {
  readonly count: number;
  readonly sides: number;
  readonly bonus: number;
}

function isDice(value: unknown): value is DiceParameter {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return (
    typeof candidate.count === 'number' &&
    typeof candidate.sides === 'number' &&
    typeof candidate.bonus === 'number'
  );
}

/** `1d4+1` / `1d6-1` / `2d6` -- the standard tabletop dice notation, not an invented one; `bonus`
 * of exactly `0` is omitted entirely. */
export function formatDice(dice: DiceParameter): string {
  if (dice.bonus === 0) return `${dice.count}d${dice.sides}`;
  const sign = dice.bonus > 0 ? '+' : '-';
  return `${dice.count}d${dice.sides}${sign}${Math.abs(dice.bonus)}`;
}

/**
 * Humanized effect copy, with obvious parameter phrasing layered on for the effect ids the
 * bundled content pack and engine actually define (`effect.heal`, `effect.damage`,
 * `effect.hunger.restore`) -- every phrasing below reads a parameter shape that already exists in
 * `content/items/*.yaml`/`content/spells/*.yaml` (dice for heal/damage, a damage type for damage)
 * and states nothing about it beyond what those fields already mean. An effect id this map doesn't
 * recognize (including `effect.item.consume`, whose only parameter -- a bare `quantity` -- has no
 * obvious phrasing beyond restating the number) falls back to plain `humanize(effectId)`, exactly
 * per the brief's "without inventing semantics".
 */
export function effectLabel(
  effectId: string,
  parameters: Readonly<Record<string, unknown>>,
): string {
  if (effectId === 'effect.heal' && isDice(parameters.dice)) {
    return `Heal ${formatDice(parameters.dice)}`;
  }
  if (effectId === 'effect.damage' && isDice(parameters.dice)) {
    const damageType = typeof parameters.damageType === 'string' ? ` ${parameters.damageType}` : '';
    return `Deal ${formatDice(parameters.dice)}${damageType} damage`;
  }
  if (effectId === 'effect.hunger.restore' && typeof parameters.amount === 'number') {
    return `Restore hunger (+${parameters.amount})`;
  }
  return humanize(effectId);
}
