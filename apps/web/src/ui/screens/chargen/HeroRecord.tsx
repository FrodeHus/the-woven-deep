import type { JSX } from 'react';
import type {
  BackgroundContentEntry, BalanceContentEntry, ClassContentEntry, ClassKitBackpackItem,
  ClassKitEquippedItem, CompiledContentPack, ItemContentEntry, TraitContentEntry,
} from '@woven-deep/content';
import { ATTRIBUTE_ORDER, DERIVED_STAT_NAMES, type DerivedStatName } from '@woven-deep/engine';
import {
  PORTRAIT_GLYPHS, wizardPreview, type WizardState,
} from '../../../session/wizard-reducer.js';
import { BlockBar, DotLeaderRow } from './chargen-components.js';
import { Button } from '../../components/button.js';
import { cn } from '../../lib/cn.js';
import { playerVisibleDerivedStats } from '../../derived-stats-display.js';

const STAT_LABELS: Readonly<Record<DerivedStatName, string>> = {
  maxHealth: 'Max health',
  meleeAccuracy: 'Melee accuracy',
  meleeDamageBonus: 'Melee damage bonus',
  rangedAccuracy: 'Ranged accuracy',
  defense: 'Defense',
  search: 'Search',
  disarm: 'Disarm',
  lightOutRevealRadius: 'Light-out reveal radius',
  lightOutMemoryPersists: 'Light-out memory persists',
};

function balanceOf(pack: CompiledContentPack): BalanceContentEntry | undefined {
  return pack.entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
}

function classOf(pack: CompiledContentPack, classId: string | null): ClassContentEntry | undefined {
  if (classId === null) return undefined;
  return pack.entries.find((entry): entry is ClassContentEntry => entry.kind === 'class' && entry.id === classId);
}

function backgroundOf(pack: CompiledContentPack, backgroundId: string | null): BackgroundContentEntry | undefined {
  if (backgroundId === null) return undefined;
  return pack.entries.find(
    (entry): entry is BackgroundContentEntry => entry.kind === 'background' && entry.id === backgroundId,
  );
}

function traitsOf(pack: CompiledContentPack, traitIds: readonly string[]): readonly TraitContentEntry[] {
  return pack.entries.filter(
    (entry): entry is TraitContentEntry => entry.kind === 'trait' && traitIds.includes(entry.id),
  );
}

function itemOf(pack: CompiledContentPack, contentId: string): ItemContentEntry | undefined {
  return pack.entries.find((entry): entry is ItemContentEntry => entry.kind === 'item' && entry.id === contentId);
}

/** Mirrors `wizardPreview`'s modifier collection, but returns the raw per-stat sums instead of
 * feeding them into `deriveActorStats` -- this is exactly the delta a hero picks up from their
 * background and traits, since `deriveActorStats` sums `heroModifiers` onto the formula result. */
function heroModifierDeltas(state: WizardState, pack: CompiledContentPack): Readonly<Partial<Record<DerivedStatName, number>>> {
  const background = backgroundOf(pack, state.backgroundId);
  const traits = traitsOf(pack, state.traitIds);
  const deltas: Partial<Record<DerivedStatName, number>> = {};
  for (const modifiers of [background?.modifiers, ...traits.map((trait) => trait.modifiers)]) {
    if (!modifiers) continue;
    for (const statName of DERIVED_STAT_NAMES) {
      const amount = modifiers[statName];
      if (amount === undefined) continue;
      deltas[statName] = (deltas[statName] ?? 0) + amount;
    }
  }
  return deltas;
}

interface LoadoutRow {
  readonly key: string;
  readonly glyph: string;
  readonly name: string;
  readonly detail: string | null;
}

function equippedRow(pack: CompiledContentPack, item: ClassKitEquippedItem): LoadoutRow {
  const entry = itemOf(pack, item.contentId);
  return {
    key: `equipped:${item.contentId}:${item.slot}`,
    glyph: entry?.glyph ?? '?',
    name: entry?.name ?? item.contentId,
    detail: item.slot,
  };
}

function backpackRow(pack: CompiledContentPack, item: ClassKitBackpackItem, keyPrefix: string): LoadoutRow {
  const entry = itemOf(pack, item.contentId);
  return {
    key: `${keyPrefix}:${item.contentId}`,
    glyph: entry?.glyph ?? '?',
    name: entry?.name ?? item.contentId,
    detail: item.quantity && item.quantity > 1 ? `×${item.quantity}` : null,
  };
}

export function HeroRecord({
  state, pack, onWeave, canWeave,
}: {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly onWeave: () => void;
  readonly canWeave: boolean;
}): JSX.Element {
  const classEntry = classOf(pack, state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const background = backgroundOf(pack, state.backgroundId);
  const balance = balanceOf(pack);
  const stats = wizardPreview(state, pack);
  const deltas = heroModifierDeltas(state, pack);

  const equippedRows = kit?.equipped.map((item) => equippedRow(pack, item)) ?? [];
  const backpackRows = [
    ...(kit?.backpack.map((item) => backpackRow(pack, item, 'backpack')) ?? []),
    ...(background?.extraItems.map((item) => backpackRow(pack, item, 'extra')) ?? []),
  ];

  const nameIsEmpty = state.name.trim().length === 0;
  const attributeMax = balance?.attributeMaximum ?? 30;

  return (
    <section aria-label="Hero record" className="flex h-full flex-col gap-4 font-mono">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-2xl text-accent"
        >
          {classEntry ? classEntry.silhouetteGlyph : (state.portraitGlyph.replace(/·.*$/, '') || PORTRAIT_GLYPHS[0])}
        </div>
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 font-serif text-xl text-fg-strong">
            {nameIsEmpty ? (
              <>
                <span
                  aria-hidden="true"
                  data-testid="hero-record-name-caret"
                  className="motion-safe:animate-pulse"
                >
                  _
                </span>
                <span className="sr-only">Unnamed hero</span>
              </>
            ) : state.name}
          </h2>
          <p className="m-0 text-sm text-muted">
            {`${classEntry?.name ?? '—'} · ${kit?.name ?? '—'}`}
          </p>
          <p className="m-0 text-sm text-muted">{background?.name ?? '—'}</p>
        </div>
      </div>

      <section aria-label="Attributes" className="flex flex-col gap-1">
        {ATTRIBUTE_ORDER.map((attributeName) => (
          <div key={attributeName} className="flex items-center gap-2 text-sm">
            <span className="w-16 shrink-0 capitalize text-fg">{attributeName}</span>
            <BlockBar value={state.attributes?.[attributeName] ?? 0} max={attributeMax} cells={10} />
            <span className="text-fg-strong">{state.attributes?.[attributeName] ?? '—'}</span>
          </div>
        ))}
      </section>

      {stats && (
        <section aria-label="Derived stats" className="flex flex-col gap-1 border-t border-line pt-2">
          <h3 className="m-0 text-sm font-semibold text-fg-strong">Derived stats</h3>
          {playerVisibleDerivedStats().map((statName) => {
            const delta = deltas[statName];
            return (
              <DotLeaderRow
                key={statName}
                label={STAT_LABELS[statName]}
                value={String(stats[statName])}
                {...(delta !== undefined ? { delta } : {})}
              />
            );
          })}
        </section>
      )}

      <section aria-label="Loadout" className="flex flex-col gap-2 border-t border-line pt-2">
        <h3 className="m-0 text-sm font-semibold text-fg-strong">Loadout</h3>
        {equippedRows.length === 0 && backpackRows.length === 0 ? (
          <p className="m-0 text-sm text-muted">Choose a class and kit to see your gear.</p>
        ) : (
          <>
            {equippedRows.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-fg">
                {equippedRows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <span aria-hidden="true" className="text-accent">{row.glyph}</span>
                    <span>{row.name}</span>
                    {row.detail && <span className="text-muted">{row.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
            {backpackRows.length > 0 && (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted">
                {backpackRows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2">
                    <span aria-hidden="true">{row.glyph}</span>
                    <span>{row.name}</span>
                    {row.detail && <span>{row.detail}</span>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="mt-auto pt-2">
        <Button
          type="button"
          variant={canWeave ? 'default' : 'outline'}
          disabled={!canWeave}
          className={cn('w-full', canWeave && 'bg-accent text-deep hover:bg-accent-strong')}
          onClick={onWeave}
        >
          ▸ WEAVE THE HERO
        </Button>
      </div>
    </section>
  );
}
