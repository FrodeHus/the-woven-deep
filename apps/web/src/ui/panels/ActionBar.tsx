import type { JSX } from 'react';
import { heroOf, type OwnedItemView } from '../../session/projection-view.js';
import type { RunSession } from '../../session/run-session.js';
import { chordKey, type ResolvedKeymap } from '../../session/settings.js';
import { isPotion } from '../overlays/inventory-model.js';
import { Gauge } from './Gauge.js';
import type { PanelProps } from './types.js';

const BELT_SIZE = 4;

function BeltSlot({
  item,
  index,
  onUse,
}: Readonly<{
  item: OwnedItemView | undefined;
  index: number;
  onUse: (itemId: string) => void;
}>): JSX.Element {
  if (!item) {
    return (
      <div
        aria-hidden="true"
        data-testid={`belt-slot-${index}`}
        className="flex size-9 items-center justify-center rounded border border-dashed border-line/60 font-mono text-[0.625rem] text-subtle"
      >
        {index + 1}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={`belt-slot-${index}`}
      title={item.name}
      onClick={() => onUse(item.itemId)}
      className="flex size-9 flex-col items-center justify-center gap-0.5 rounded border border-accent bg-raised font-mono text-accent-strong hover:bg-accent hover:text-deep"
    >
      <span aria-hidden="true">{item.glyph ?? '!'}</span>
      <span className="text-[0.5rem]">{item.quantity}</span>
    </button>
  );
}

export interface ActionBarProps extends PanelProps {
  readonly session: RunSession;
  readonly keymap: ResolvedKeymap;
  readonly onBeginCast: (spellId: string) => void;
}

/**
 * The bottom-center HUD card: the hero's life-thread and weave dials flank a belt of up to four
 * potions and (when the hero knows any spells) a quick-cast button for the first one, with a
 * static control-hint line underneath built from the *resolved* keymap so a rebound chord shows
 * correctly. Purely a floating chrome card -- `PlayScreen` positions it as floating bottom-center
 * chrome; this component owns only its own card layout.
 */
export function ActionBar({ snapshot, session, keymap, onBeginCast }: ActionBarProps): JSX.Element {
  const hero = heroOf(snapshot.projection);
  const potions = hero.backpack.filter(isPotion);
  const firstSpell = hero.castableSpells?.[0];

  const useSlot = (itemId: string): void => {
    session.dispatch({ type: 'backpack', action: 'use', itemId });
  };

  const hint = [
    'move',
    `${chordKey(keymap.byAction.inventory)} pack`,
    `${chordKey(keymap.byAction['character-sheet'])} hero`,
    `${chordKey(keymap.byAction.pickup)} pickup`,
    `${chordKey(keymap.byAction['use-belt-1'])} drink`,
    '⌘K commands',
  ].join(' · ');

  return (
    <div
      data-testid="action-bar"
      className="flex items-end gap-4 rounded-t-md border border-b-0 border-line bg-gradient-to-t from-black/90 to-surface/80 px-4 pb-3 pt-2 backdrop-blur-sm"
    >
      <Gauge label="Life-thread" value={hero.health} max={hero.maxHealth} tone="hp" />
      <div className="flex flex-col items-center gap-2 px-2">
        <div className="flex gap-1.5">
          {Array.from({ length: BELT_SIZE }, (_, index) => (
            <BeltSlot key={index} item={potions[index]} index={index} onUse={useSlot} />
          ))}
        </div>
        {firstSpell && (
          <button
            type="button"
            data-testid="cast-button"
            onClick={() => onBeginCast(firstSpell.spellId)}
            className="cursor-pointer whitespace-nowrap border border-accent bg-raised px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-accent-strong hover:bg-accent hover:text-deep"
          >
            {`Cast: ${firstSpell.name}`}
          </button>
        )}
        <p className="font-mono text-[0.625rem] text-subtle">{hint}</p>
      </div>
      <Gauge label="Weave" value={hero.weave} max={hero.maxWeave} tone="weave" />
    </div>
  );
}
