import { useMemo, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  BackgroundContentEntry, BalanceContentEntry, ClassContentEntry, CompiledContentPack, TraitContentEntry,
} from '@woven-deep/content';
import {
  ATTRIBUTE_ORDER, DERIVED_STAT_NAMES, HERO_NAME_RULES, pointBuyCost,
  type AttributeName, type DerivedStatName,
} from '@woven-deep/engine';
import { Button } from '@/ui/components/button.js';
import { Input } from '@/ui/components/input.js';
import { Label } from '@/ui/components/label.js';
import { cn } from '@/ui/lib/cn.js';
import {
  PORTRAIT_GLYPHS, wizardPreview, type WizardAction, type WizardState,
} from '../../../session/wizard-reducer.js';
import { BlockBar, DotLeaderRow } from './chargen-components.js';
import { AttributeStepper } from './AttributeStepper.js';
import { OptionRow } from './OptionRow.js';
import { FilterBar } from './FilterBar.js';
import { useListFacets } from './use-list-facets.js';
import { useListNavigation } from '../roving-focus.js';

export interface StepProps {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly dispatch: (action: WizardAction) => void;
}

const RANDOM_NAMES = ['Rin', 'Kael', 'Mira', 'Thane', 'Sable', 'Doran', 'Wren', 'Ysolde'] as const;

const OPTION_SELECTED_CLASS = 'outline outline-2 outline-accent outline-offset-2 border-accent';

function isNameValid(name: string): boolean {
  return (
    name.length >= HERO_NAME_RULES.minLength
    && name.length <= HERO_NAME_RULES.maxLength
    && HERO_NAME_RULES.pattern.test(name)
  );
}

function pickRandomName(): string {
  const index = Math.floor(Math.random() * RANDOM_NAMES.length);
  return RANDOM_NAMES[index] ?? RANDOM_NAMES[0];
}

export function IdentityStep({ state, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(PORTRAIT_GLYPHS.length);
  const valid = isNameValid(state.name);

  return (
    <section aria-label="Name and portrait" className="flex flex-col gap-3 font-mono">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chargen-name">Name</Label>
        <div className="flex items-center gap-2">
          <span className="text-muted">{'>'}</span>
          <Input
            id="chargen-name"
            type="text"
            value={state.name}
            maxLength={HERO_NAME_RULES.maxLength}
            onChange={(event) => dispatch({ type: 'set-name', name: event.target.value })}
            autoFocus
            className="flex-1"
          />
          <Button type="button" variant="outline" onClick={() => dispatch({ type: 'set-name', name: pickRandomName() })}>
            {'⟳ RANDOM'}
          </Button>
        </div>
        <span className={cn('text-xs', valid ? 'text-muted' : 'text-danger')}>
          {valid ? `1-${HERO_NAME_RULES.maxLength} characters` : 'Name is invalid'}
        </span>
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Portrait</legend>
        <div role="listbox" aria-label="Portrait" className="flex flex-row flex-wrap gap-2" onKeyDown={handleArrowKeys}>
          {PORTRAIT_GLYPHS.map((glyph, index) => (
            <button
              key={glyph}
              type="button"
              role="option"
              aria-selected={state.portraitGlyph === glyph}
              ref={registerItem(index)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface',
                index === selectedIndex && OPTION_SELECTED_CLASS,
              )}
              data-glyph={glyph}
              onClick={() => dispatch({ type: 'set-portrait', glyph })}
            >
              <span aria-hidden="true">@</span>
            </button>
          ))}
        </div>
      </fieldset>
      <Label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line accent-accent"
          checked={state.onboardingEnabled}
          onChange={(event) => dispatch({ type: 'set-onboarding-enabled', enabled: event.target.checked })}
        />
        Show guidance on your first delve
      </Label>
    </section>
  );
}

const METHOD_OPTIONS = [
  { method: 'point-buy' as const, label: 'POINT-BUY' },
  { method: 'roll' as const, label: 'ROLL 3D6' },
];

function balanceEntry(pack: CompiledContentPack): BalanceContentEntry | undefined {
  return pack.entries.find((entry): entry is BalanceContentEntry => entry.kind === 'balance');
}

function AttributeReadout({ state }: { readonly state: WizardState }): JSX.Element {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted">
      {ATTRIBUTE_ORDER.map((attributeName) => (
        <li key={attributeName}>{`${attributeName}: ${state.attributes?.[attributeName] ?? '—'}`}</li>
      ))}
    </ul>
  );
}

function RollAttributes({ state, dispatch }: StepProps): JSX.Element {
  if (state.attributes === null) {
    return <Button type="button" autoFocus className="self-start" onClick={() => dispatch({ type: 'roll' })}>Roll attributes</Button>;
  }
  return (
    <div className="flex flex-col gap-2">
      <AttributeReadout state={state} />
      <Button
        type="button"
        variant="outline"
        className="self-start"
        disabled={state.rerollUsed}
        onClick={() => dispatch({ type: 'reroll' })}
      >
        {state.rerollUsed ? 'Reroll used' : 'Reroll'}
      </Button>
    </div>
  );
}

function PointBuyAttributes({ state, pack, dispatch }: StepProps): JSX.Element {
  const balance = balanceEntry(pack);
  const spent = balance && state.attributes ? pointBuyCost(state.attributes, balance.pointBuy) : 0;
  const budget = balance?.pointBuy.budget ?? 0;
  const min = balance?.attributeMinimum ?? 0;
  const max = balance?.attributeMaximum ?? 0;

  const costFor = (value: number): number => balance?.pointBuy.costs.find((row) => row.value === value)?.cost ?? 0;

  const attemptSpent = (attributeName: AttributeName, value: number): number => {
    if (!balance || !state.attributes) return 0;
    return pointBuyCost({ ...state.attributes, [attributeName]: value }, balance.pointBuy);
  };

  const adjust = (attributeName: AttributeName, delta: number): void => {
    if (!state.attributes) return;
    dispatch({ type: 'set-attribute', attribute: attributeName, value: state.attributes[attributeName] + delta });
  };

  return (
    <div className="flex flex-col gap-3 font-mono">
      <div className="flex items-center gap-2">
        <span className="text-fg">{`Points: ${spent}/${budget}`}</span>
        <BlockBar value={spent} max={budget} cells={30} />
      </div>
      <div className="flex flex-col gap-2">
        {ATTRIBUTE_ORDER.map((attributeName) => {
          const value = state.attributes?.[attributeName] ?? min;
          const canDecrement = value > min;
          const canIncrement = value < max && attemptSpent(attributeName, value + 1) <= budget;
          return (
            <AttributeStepper
              key={attributeName}
              abbr={attributeName.slice(0, 3).toUpperCase()}
              label={attributeName.charAt(0).toUpperCase() + attributeName.slice(1)}
              cost={costFor(value)}
              value={value}
              max={max}
              canDecrement={canDecrement}
              canIncrement={canIncrement}
              onDecrement={() => adjust(attributeName, -1)}
              onIncrement={() => adjust(attributeName, 1)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function AttributesStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(METHOD_OPTIONS.length);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    handleArrowKeys(event);
  };

  return (
    <section aria-label="Attributes" className="flex flex-col gap-3">
      <div role="listbox" aria-label="Attribute method" className="flex flex-row gap-1.5 font-mono" onKeyDown={handleKeyDown}>
        {METHOD_OPTIONS.map((option, index) => (
          <button
            key={option.method}
            type="button"
            role="option"
            aria-selected={state.method === option.method}
            ref={registerItem(index)}
            className={cn(
              'rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-fg hover:bg-raised',
              index === selectedIndex && OPTION_SELECTED_CLASS,
            )}
            onClick={() => dispatch({ type: 'choose-method', method: option.method })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.method === 'roll' && <RollAttributes state={state} pack={pack} dispatch={dispatch} />}
      {state.method === 'point-buy' && <PointBuyAttributes state={state} pack={pack} dispatch={dispatch} />}
    </section>
  );
}

function classEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return pack.entries.filter((entry): entry is ClassContentEntry => entry.kind === 'class');
}

export function CallingStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = classEntries(pack);
  const facets = useListFacets(entries);
  const { registerItem, handleArrowKeys } = useListNavigation(facets.filtered.length);

  return (
    <section aria-label="Calling" className="flex flex-col gap-3 font-mono">
      <FilterBar facets={facets} />
      <div role="listbox" aria-label="Calling" className="flex flex-col gap-1.5" onKeyDown={handleArrowKeys}>
        {facets.filtered.map((entry, index) => (
          <OptionRow
            key={entry.id}
            ref={registerItem(index)}
            glyph={entry.silhouetteGlyph}
            name={entry.name}
            description={entry.description}
            tags={entry.tags}
            marker="single"
            selected={state.classId === entry.id}
            locked={!entry.playable}
            {...(entry.unlockHint ? { lockHint: entry.unlockHint } : {})}
            onSelect={() => { if (entry.playable) dispatch({ type: 'choose-class', classId: entry.id }); }}
          />
        ))}
      </div>
    </section>
  );
}

interface FacetedKit {
  readonly kitId: string;
  readonly name: string;
  readonly tags: readonly string[];
}

export function KitStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = classEntries(pack);
  const classEntry = entries.find((entry) => entry.id === state.classId);
  const kits = useMemo<readonly FacetedKit[]>(
    () => (classEntry?.kits ?? []).map((kit) => ({ kitId: kit.kitId, name: kit.name, tags: [] })),
    [classEntry],
  );
  const facets = useListFacets(kits);
  const { registerItem, handleArrowKeys } = useListNavigation(facets.filtered.length);

  if (!classEntry) {
    return <p className="text-sm text-muted">Choose a calling first.</p>;
  }

  return (
    <section aria-label="Kit" className="flex flex-col gap-3 font-mono">
      <FilterBar facets={facets} />
      <div role="listbox" aria-label="Kit" className="flex flex-col gap-1.5" onKeyDown={handleArrowKeys}>
        {facets.filtered.map((kit, index) => (
          <OptionRow
            key={kit.kitId}
            ref={registerItem(index)}
            name={kit.name}
            marker="single"
            selected={state.kitId === kit.kitId}
            onSelect={() => dispatch({ type: 'choose-kit', kitId: kit.kitId })}
          />
        ))}
      </div>
    </section>
  );
}

function modifiersMeta(modifiers: Readonly<Partial<Record<DerivedStatName, number>>>): string | undefined {
  const parts = DERIVED_STAT_NAMES
    .filter((statName) => modifiers[statName] !== undefined)
    .map((statName) => `${modifiers[statName]! >= 0 ? '+' : ''}${modifiers[statName]} ${statName}`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function backgroundEntries(pack: CompiledContentPack): readonly BackgroundContentEntry[] {
  return pack.entries.filter((entry): entry is BackgroundContentEntry => entry.kind === 'background');
}

export function OriginStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = backgroundEntries(pack);
  const facets = useListFacets(entries);
  const { registerItem, handleArrowKeys } = useListNavigation(facets.filtered.length);

  return (
    <section aria-label="Origin" className="flex flex-col gap-3 font-mono">
      <FilterBar facets={facets} />
      <div role="listbox" aria-label="Origin" className="flex flex-col gap-1.5" onKeyDown={handleArrowKeys}>
        {facets.filtered.map((entry, index) => {
          const meta = modifiersMeta(entry.modifiers);
          return (
            <OptionRow
              key={entry.id}
              ref={registerItem(index)}
              name={entry.name}
              {...(meta ? { meta } : {})}
              description={entry.description}
              tags={entry.tags}
              marker="single"
              selected={state.backgroundId === entry.id}
              onSelect={() => dispatch({ type: 'choose-background', backgroundId: entry.id })}
            />
          );
        })}
      </div>
    </section>
  );
}

function traitEntries(pack: CompiledContentPack): readonly TraitContentEntry[] {
  return pack.entries.filter((entry): entry is TraitContentEntry => entry.kind === 'trait');
}

const STAT_LABELS: Readonly<Record<DerivedStatName, string>> = {
  maxHealth: 'Max health',
  meleeAccuracy: 'Melee accuracy',
  meleeDamageBonus: 'Melee damage bonus',
  rangedAccuracy: 'Ranged accuracy',
  defense: 'Defense',
  search: 'Search',
  disarm: 'Disarm',
};

export function TraitsStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = traitEntries(pack);
  const facets = useListFacets(entries);
  const { registerItem, handleArrowKeys } = useListNavigation(facets.filtered.length);
  const atCap = state.traitIds.length >= 2;

  return (
    <section aria-label="Traits" className="flex flex-col gap-3 font-mono">
      <FilterBar facets={facets} />
      <span className="text-sm text-muted">{`${state.traitIds.length}/2`}</span>
      <div
        role="listbox"
        aria-label="Traits"
        aria-multiselectable="true"
        className="flex flex-col gap-1.5"
        onKeyDown={handleArrowKeys}
      >
        {facets.filtered.map((entry, index) => {
          const selected = state.traitIds.includes(entry.id);
          const meta = modifiersMeta(entry.modifiers);
          return (
            <OptionRow
              key={entry.id}
              ref={registerItem(index)}
              name={entry.name}
              {...(meta ? { meta } : {})}
              description={entry.description}
              tags={entry.tags}
              marker="multi"
              selected={selected}
              locked={!selected && atCap}
              onSelect={() => dispatch({ type: 'toggle-trait', traitId: entry.id })}
            />
          );
        })}
      </div>
    </section>
  );
}

export function ReviewStep({ state, pack }: StepProps): JSX.Element {
  const classEntry = classEntries(pack).find((entry) => entry.id === state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const background = backgroundEntries(pack).find((entry) => entry.id === state.backgroundId);
  const chosenTraits = traitEntries(pack).filter((entry) => state.traitIds.includes(entry.id));
  const stats = wizardPreview(state, pack);

  return (
    <section aria-label="Review" className="flex flex-col gap-3 font-mono">
      <h2 className="m-0 font-serif text-2xl text-accent-strong">{state.name || '—'}</h2>
      <div className="flex flex-col gap-1">
        <DotLeaderRow label="Calling" value={classEntry?.name ?? '—'} />
        <DotLeaderRow label="Kit" value={kit?.name ?? '—'} />
        <DotLeaderRow label="Origin" value={background?.name ?? '—'} />
        <DotLeaderRow
          label="Traits"
          value={chosenTraits.length > 0 ? chosenTraits.map((trait) => trait.name).join(', ') : 'None'}
        />
      </div>
      <div className="flex flex-col gap-1 border-t border-line pt-2">
        <h3 className="m-0 text-sm font-semibold text-fg-strong">Attributes</h3>
        {ATTRIBUTE_ORDER.map((attributeName) => (
          <DotLeaderRow
            key={attributeName}
            label={attributeName.charAt(0).toUpperCase() + attributeName.slice(1)}
            value={String(state.attributes?.[attributeName] ?? '—')}
          />
        ))}
      </div>
      {stats && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          <h3 className="m-0 text-sm font-semibold text-fg-strong">Derived stats</h3>
          {DERIVED_STAT_NAMES.map((statName) => (
            <DotLeaderRow key={statName} label={STAT_LABELS[statName]} value={String(stats[statName])} />
          ))}
        </div>
      )}
      <p className="m-0 text-sm italic text-muted">
        {`${state.name || 'This hero'} steps into the dark, ${classEntry?.name ?? 'unproven'} and ${background?.name ?? 'unbound by fate'}.`}
      </p>
    </section>
  );
}
