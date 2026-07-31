import type { CompiledContentPack } from '@woven-deep/content';
import type { ItemInstance } from './item-model.js';
import type { ActiveRun, DomainEvent, OpaqueId } from './model.js';

export type { CurseRevealedEvent } from './events-model.js';

/** True while a revealed cursed item is welded to the hero's body. */
export function itemIsWelded(item: ItemInstance): boolean {
  return item.curse !== undefined && item.curse.revealed && item.location.type === 'equipped';
}

/**
 * Marks an item's curse revealed and returns the reveal event. A no-op (same run, no events) for an
 * uncursed item or one whose curse is already revealed, so every caller can invoke it blind.
 */
export function revealItemCurse(
  input: Readonly<{
    run: ActiveRun;
    content: CompiledContentPack;
    itemId: OpaqueId;
    eventId: OpaqueId;
  }>,
): Readonly<{ state: ActiveRun; events: readonly DomainEvent[] }> {
  const item = input.run.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item?.curse || item.curse.revealed) return { state: input.run, events: [] };
  const curseId = item.curse.curseId;
  const curse = input.content.entries.find(
    (entry) => entry.kind === 'curse' && entry.id === curseId,
  );
  if (!curse || curse.kind !== 'curse') {
    throw new Error(`internal invariant: curse definition ${curseId} does not exist`);
  }
  const revealed: ItemInstance = { ...item, curse: { ...item.curse, revealed: true } };
  return {
    state: {
      ...input.run,
      items: input.run.items.map((candidate) =>
        candidate.itemId === item.itemId ? revealed : candidate,
      ),
    },
    events: [
      {
        type: 'curse.revealed',
        eventId: input.eventId,
        itemId: item.itemId,
        curseId,
        revealText: curse.revealText,
      },
    ],
  };
}
