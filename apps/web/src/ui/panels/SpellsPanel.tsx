import type { JSX } from 'react';
import { cn } from '../lib/cn.js';
import { hero, type PanelProps } from './types.js';

export interface SpellsPanelProps extends PanelProps {
  readonly onCast: (spellId: string) => void;
}

/** The gated HUD spellbook: one row per spell the hero currently knows and can cast, disabled
 * when the hero doesn't have enough Weave to pay its cost. Renders nothing for non-caster heroes
 * (an absent or empty `castableSpells`), so the panel simply doesn't exist in the DOM for them. */
export function SpellsPanel({ snapshot, onCast }: SpellsPanelProps): JSX.Element | null {
  const heroData = hero(snapshot);
  const spells = heroData.castableSpells ?? [];
  if (spells.length === 0) {
    return null;
  }
  return (
    <section
      aria-label="Spells"
      className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3 text-sm text-fg"
    >
      <ul className="flex flex-col gap-1">
        {spells.map((spell) => {
          const affordable = heroData.weave >= spell.weaveCost;
          return (
            <li key={spell.spellId}>
              <button
                type="button"
                disabled={!affordable}
                onClick={() => onCast(spell.spellId)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left',
                  affordable
                    ? 'text-fg hover:bg-raised'
                    : 'cursor-not-allowed text-muted opacity-60',
                )}
              >
                <span>{spell.name}</span>
                <span className="text-xs text-muted">{`${spell.weaveCost} Weave · rng ${spell.range}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
