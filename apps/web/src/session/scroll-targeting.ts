import type { CompiledContentPack } from '@woven-deep/content';
import { itemById, spellEntries } from '@woven-deep/session-core';
import type { CastableSpellView } from './projection-view.js';

const AIMED_TARGETING = new Set(['target.actor', 'target.burst', 'target.line', 'target.cone']);

/**
 * The aim-requiring spell an item casts when used, or `null` when using it needs no aim step.
 * A scroll carries a `spellId`; if that spell targets an actor or an area, using the scroll opens
 * the same free-cursor targeting mode as casting (see `useSpellTargeting.beginScroll`). Self-target
 * scrolls, potions, food, and tomes (which LEARN a spell via `effect.spell.learn` rather than cast
 * one) return `null` and stay fire-and-forget.
 */
export function scrollAimSpell(
  pack: CompiledContentPack,
  contentId: string | undefined,
): Pick<CastableSpellView, 'spellId' | 'name' | 'range' | 'targetingId' | 'aoe'> | null {
  if (contentId === undefined) return null;
  const item = itemById(pack, contentId);
  const spellId = item?.spellId;
  if (typeof spellId !== 'string') return null;
  const spell = spellEntries(pack).find((entry) => entry.id === spellId);
  if (!spell || !AIMED_TARGETING.has(spell.targetingId)) return null;
  return {
    spellId: spell.id,
    name: spell.name,
    range: spell.range,
    targetingId: spell.targetingId,
    ...(spell.aoe === undefined
      ? {}
      : { aoe: { shape: spell.aoe.shape, radius: spell.aoe.radius } }),
  };
}
