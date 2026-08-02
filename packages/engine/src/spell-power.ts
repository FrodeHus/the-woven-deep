import type { CompiledContentPack } from '@woven-deep/content';
import type { ActorState } from './actor-model.js';
import { balanceEntry } from './balance.js';
import type { ActiveRun } from './model.js';
import { deriveRunActorStats } from './stats.js';

/**
 * The caster's spell bonus: `floor(max(0, spellPower) / spellPowerDivisor)` where `spellPower` is
 * the ordinary derived stat (`{ base: -10, wits: 1 }` in shipping balance, so raw is `wits - 10`).
 * Quotient math on safe integers; never negative. Identical for heroes, monsters, and champions --
 * they all derive from their own stats through the same call.
 */
export function spellPowerFor(
  input: Readonly<{ state: ActiveRun; content: CompiledContentPack; actor: ActorState }>,
): number {
  const raw = deriveRunActorStats({
    state: input.state,
    content: input.content,
    actor: input.actor,
  }).spellPower;
  const divisor = balanceEntry(input.content).spellPowerDivisor;
  if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(divisor) || divisor < 1) {
    throw new RangeError('spell power derivation requires safe integers and a positive divisor');
  }
  // `raw` is already `wits - baseline` (the formula carries the baseline in its `base` term), so a
  // caster below the baseline contributes nothing rather than a penalty. Truncation on a positive
  // numerator IS floor -- the codebase's quotient idiom, no float survives.
  return raw <= 0 ? 0 : Math.trunc(raw / divisor);
}
