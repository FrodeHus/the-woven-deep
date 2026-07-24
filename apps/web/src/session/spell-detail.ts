import type { CompiledContentPack } from '@woven-deep/content';
import { spellEntries } from '@woven-deep/session-core';
import type { CastableSpellView } from './projection-view.js';

type Aoe = CastableSpellView['aoe'];

/** The list-row badge for a spell's area shape, or `null` for a single-target spell. */
export function aoeBadge(aoe: Aoe): string | null {
  if (aoe === undefined) return null;
  return aoe.shape === 'burst' ? `burst r${aoe.radius}` : aoe.shape;
}

const TARGETING_LABEL: Readonly<Record<string, string>> = {
  'target.self': 'Self',
  'target.actor': 'Single target',
  'target.burst': 'Burst (area)',
  'target.line': 'Line (area)',
  'target.cone': 'Cone (area)',
  'target.cell': 'Ground',
};

/** Derived display metadata for a spell. Spells have no authored prose (the content model has no
 * `description` on a spell), so the "detail" is this effects/targeting/AoE summary read from the
 * pack's `SpellContentEntry.effects`, plus the runtime `CastableSpellView` numbers. */
export function describeSpell(
  input: Readonly<{ spell: CastableSpellView; pack: CompiledContentPack }>,
): Readonly<{
  aoeBadge: string | null;
  rangeLabel: string;
  targetingLabel: string;
  effects: readonly string[];
}> {
  const { spell, pack } = input;
  const entry = spellEntries(pack).find((candidate) => candidate.id === spell.spellId);
  const effects = (entry?.effects ?? []).map((effect) => effect.effectId.replace(/^effect\./, ''));
  return {
    aoeBadge: aoeBadge(spell.aoe),
    rangeLabel: `Range ${spell.range}`,
    targetingLabel: TARGETING_LABEL[spell.targetingId] ?? spell.targetingId,
    effects,
  };
}
