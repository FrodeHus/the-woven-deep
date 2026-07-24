import { useState, type JSX } from 'react';
import { heroOf } from '../../session/projection-view.js';
import { usePack, useSessionCtx } from '../providers.js';
import { ListDetail, type ListDetailItem } from '../components/ListDetail.js';
import { aoeBadge, describeSpell } from '../../session/spell-detail.js';

export interface SpellbookOverlayProps {
  /** Enters the shared spell-targeting mode for the selected spell (`useSpellTargeting.begin`) --
   * the same path the always-on HUD `SpellsPanel` uses. Optional so every pre-existing caller/test
   * keeps compiling unchanged. */
  readonly onCast?: ((spellId: string) => void) | undefined;
}

/**
 * The browsable spellbook: a list+detail view of every spell the hero currently knows, built on
 * the shared `ListDetail` primitive (mirrors `InventoryOverlay`). Unlike the always-on HUD
 * `SpellsPanel`, this is the *browse* surface -- each row carries an AoE-shape badge, and the
 * detail pane shows a derived summary (spells have no authored description prose; see
 * `describeSpell`) plus a Cast button that enters the same targeting flow as the HUD panel.
 */
export function SpellbookOverlay({
  onCast,
}: Readonly<SpellbookOverlayProps> = {}): JSX.Element | null {
  const sessionCtx = useSessionCtx();
  const pack = usePack();
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!sessionCtx) return null;
  const hero = heroOf(sessionCtx.snapshot.projection);
  const spells = hero.castableSpells ?? [];

  if (spells.length === 0) {
    return <p className="text-muted">You know no spells.</p>;
  }

  const items: ListDetailItem[] = spells.map((spell) => {
    const badge = aoeBadge(spell.aoe);
    return {
      id: spell.spellId,
      label: spell.name,
      ...(badge ? { badge } : {}),
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <ListDetail
        listLabel="Known spells"
        items={items}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        renderDetail={(item) => {
          const spell = spells.find((candidate) => candidate.spellId === item?.id);
          if (!spell) return null;
          const detail = describeSpell({ spell, pack });
          const affordable = hero.weave >= spell.weaveCost;
          return (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{spell.name}</h3>
              <p className="text-xs text-muted">
                {`${spell.weaveCost} Weave · ${detail.rangeLabel} · ${detail.targetingLabel}`}
              </p>
              {detail.aoeBadge && <p className="text-xs">{`Area: ${detail.aoeBadge}`}</p>}
              {detail.effects.length > 0 && (
                <ul className="text-xs text-muted">
                  {detail.effects.map((effect) => (
                    <li key={effect}>{effect}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                disabled={!affordable}
                onClick={() => onCast?.(spell.spellId)}
                className="mt-1 w-fit rounded-sm border border-accent px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cast
              </button>
            </div>
          );
        }}
      />
      <p className="mt-1 border-t border-line pt-2 font-mono text-[0.6875rem] text-subtle">
        ↑↓ browse
      </p>
    </div>
  );
}
