import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  BackgroundContentEntry, ClassContentEntry, CompiledContentPack, TraitContentEntry,
} from '@woven-deep/content';
import {
  ATTRIBUTE_ORDER, DERIVED_STAT_NAMES, HERO_NAME_RULES, pointBuyCost, type AttributeName,
} from '@woven-deep/engine';
import {
  PORTRAIT_GLYPHS, wizardPreview, type WizardAction, type WizardState,
} from '../../session/wizard-reducer.js';
import { useListNavigation } from './roving-focus.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Label } from '../components/label.js';
import { cn } from '../lib/cn.js';

export interface StepProps {
  readonly state: WizardState;
  readonly pack: CompiledContentPack;
  readonly dispatch: (action: WizardAction) => void;
}

const STAT_LABELS: Readonly<Record<string, string>> = {
  maxHealth: 'Max health',
  meleeAccuracy: 'Melee accuracy',
  meleeDamageBonus: 'Melee damage bonus',
  rangedAccuracy: 'Ranged accuracy',
  defense: 'Defense',
  search: 'Search',
  disarm: 'Disarm',
};

/** Tailwind text-color utility keyed by portrait glyph id, mirroring the previous
 * `--portrait-accent` custom-property mapping (`data-glyph` -> hue). */
const PORTRAIT_GLYPH_CLASS: Readonly<Record<string, string>> = {
  '@': 'text-fg-strong',
  '@·gold': 'text-accent',
  '@·ember': 'text-danger',
  '@·mist': 'text-muted',
  '@·moss': 'text-good',
};

const OPTION_BUTTON_CLASS = 'flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-left text-sm text-fg hover:bg-raised';
const OPTION_SELECTED_CLASS = 'outline outline-2 outline-accent outline-offset-2 border-accent';
const OPTION_LOCKED_CLASS = 'cursor-not-allowed opacity-55';

/** Derived-stats preview panel, shown on the attributes step and the summary step. */
export function PreviewPanel({ state, pack }: { readonly state: WizardState; readonly pack: CompiledContentPack }): JSX.Element | null {
  const stats = wizardPreview(state, pack);
  if (!stats) return null;
  return (
    <section aria-label="Derived stats preview" className="flex flex-col gap-1 border-t border-line pt-2">
      <h3 className="m-0 text-sm font-semibold text-fg-strong">Derived stats</h3>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted">
        {DERIVED_STAT_NAMES.map((statName) => (
          <li key={statName}>{`${STAT_LABELS[statName] ?? statName}: ${stats[statName]}`}</li>
        ))}
      </ul>
    </section>
  );
}

export function NameStep({ state, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(PORTRAIT_GLYPHS.length);

  const handlePortraitKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    handleArrowKeys(event);
  };

  return (
    <section aria-label="Name and portrait" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chargen-name">Name</Label>
        <Input
          id="chargen-name"
          type="text"
          value={state.name}
          maxLength={HERO_NAME_RULES.maxLength}
          onChange={(event) => dispatch({ type: 'set-name', name: event.target.value })}
          autoFocus
        />
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Portrait</legend>
        <div
          role="listbox"
          aria-label="Portrait"
          className="flex flex-row flex-wrap gap-2"
          onKeyDown={handlePortraitKeyDown}
        >
          {PORTRAIT_GLYPHS.map((glyph, index) => (
            <button
              key={glyph}
              type="button"
              role="option"
              aria-selected={state.portraitGlyph === glyph}
              ref={registerItem(index)}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface',
                PORTRAIT_GLYPH_CLASS[glyph],
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
  { method: 'roll' as const, label: 'Roll (3d6 per attribute)' },
  { method: 'point-buy' as const, label: 'Point buy' },
];

export function MethodStep({ state, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(METHOD_OPTIONS.length);

  return (
    <section aria-label="Attribute method" className="flex flex-col gap-3">
      <div role="listbox" aria-label="Attribute method" className="flex flex-col gap-1.5" onKeyDown={handleArrowKeys}>
        {METHOD_OPTIONS.map((option, index) => (
          <button
            key={option.method}
            type="button"
            role="option"
            aria-selected={state.method === option.method}
            ref={registerItem(index)}
            className={cn(OPTION_BUTTON_CLASS, index === selectedIndex && OPTION_SELECTED_CLASS)}
            onClick={() => dispatch({ type: 'choose-method', method: option.method })}
          >
            {option.label}
          </button>
        ))}
      </div>
    </section>
  );
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

function PointBuyAttributes({ state, pack, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(ATTRIBUTE_ORDER.length);
  const balance = pack.entries.find((entry) => entry.kind === 'balance') as
    | { attributeMinimum: number; attributeMaximum: number; pointBuy: { budget: number; costs: readonly { value: number; cost: number }[] } }
    | undefined;
  const spent = balance && state.attributes ? pointBuyCost(state.attributes, balance.pointBuy) : 0;
  const budget = balance?.pointBuy.budget ?? 0;

  const adjust = (attributeName: AttributeName, delta: number): void => {
    if (!state.attributes) return;
    dispatch({ type: 'set-attribute', attribute: attributeName, value: state.attributes[attributeName] + delta });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (handleArrowKeys(event)) return;
    const attributeName = ATTRIBUTE_ORDER[selectedIndex];
    if (!attributeName) return;
    if (event.key === 'ArrowRight' || event.key === '+') {
      event.preventDefault();
      adjust(attributeName, 1);
    } else if (event.key === 'ArrowLeft' || event.key === '-') {
      event.preventDefault();
      adjust(attributeName, -1);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm text-muted">{`Points spent: ${spent}/${budget}`}</p>
      <div
        role="listbox"
        aria-label="Point-buy attributes"
        className="flex flex-col gap-1.5"
        onKeyDown={handleKeyDown}
      >
        {ATTRIBUTE_ORDER.map((attributeName, index) => (
          <div
            key={attributeName}
            role="option"
            aria-selected={index === selectedIndex}
            tabIndex={-1}
            ref={registerItem(index)}
            className={cn(
              'flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-sm text-fg',
              index === selectedIndex && OPTION_SELECTED_CLASS,
            )}
          >
            <span className="w-24 capitalize">{attributeName}</span>
            <Button type="button" variant="outline" size="icon" aria-label={`Decrease ${attributeName}`} onClick={() => adjust(attributeName, -1)}>-</Button>
            <span className="w-6 text-center">{state.attributes?.[attributeName] ?? 0}</span>
            <Button type="button" variant="outline" size="icon" aria-label={`Increase ${attributeName}`} onClick={() => adjust(attributeName, 1)}>+</Button>
          </div>
        ))}
      </div>
      <p className="m-0 text-sm text-muted">↑↓ select attribute · ←→ adjust value</p>
    </div>
  );
}

export function AttributesStep({ state, pack, dispatch }: StepProps): JSX.Element {
  return (
    <section aria-label="Attributes" className="flex flex-col gap-3">
      {state.method === 'roll' && (
        <div className="flex flex-col gap-2">
          {state.attributes === null
            ? <Button type="button" autoFocus className="self-start" onClick={() => dispatch({ type: 'roll' })}>Roll attributes</Button>
            : (
              <>
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
              </>
            )}
        </div>
      )}
      {state.method === 'point-buy' && <PointBuyAttributes state={state} pack={pack} dispatch={dispatch} />}
      <PreviewPanel state={state} pack={pack} />
    </section>
  );
}

function classEntries(pack: CompiledContentPack): readonly ClassContentEntry[] {
  return pack.entries.filter((entry): entry is ClassContentEntry => entry.kind === 'class');
}

export function ClassStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = classEntries(pack);
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(entries.length);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    handleArrowKeys(event);
  };

  return (
    <section aria-label="Class" className="flex flex-col gap-3">
      <div role="listbox" aria-label="Class" className="flex flex-col gap-1.5" onKeyDown={handleKeyDown}>
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={state.classId === entry.id}
            aria-disabled={!entry.playable}
            ref={registerItem(index)}
            disabled={!entry.playable}
            className={cn(
              OPTION_BUTTON_CLASS,
              !entry.playable ? OPTION_LOCKED_CLASS : index === selectedIndex && OPTION_SELECTED_CLASS,
            )}
            onClick={() => { if (entry.playable) dispatch({ type: 'choose-class', classId: entry.id }); }}
          >
            <span aria-hidden="true" className="font-bold text-accent">{entry.silhouetteGlyph}</span>
            <span className="font-medium text-fg-strong">{entry.name}</span>
            {!entry.playable && entry.unlockHint && (
              <span className="text-sm italic text-muted">{entry.unlockHint}</span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

export function KitStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const entries = classEntries(pack);
  const classEntry = entries.find((entry) => entry.id === state.classId);
  const kits = classEntry?.kits ?? [];
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(kits.length);

  if (!classEntry) return <p className="text-sm text-muted">Choose a class first.</p>;

  return (
    <section aria-label="Kit" className="flex flex-col gap-3">
      <div role="listbox" aria-label="Kit" className="flex flex-col gap-1.5" onKeyDown={handleArrowKeys}>
        {kits.map((kit, index) => (
          <button
            key={kit.kitId}
            type="button"
            role="option"
            aria-selected={state.kitId === kit.kitId}
            ref={registerItem(index)}
            className={cn(OPTION_BUTTON_CLASS, index === selectedIndex && OPTION_SELECTED_CLASS)}
            onClick={() => dispatch({ type: 'choose-kit', kitId: kit.kitId })}
          >
            {kit.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function backgroundEntries(pack: CompiledContentPack): readonly BackgroundContentEntry[] {
  return pack.entries.filter((entry): entry is BackgroundContentEntry => entry.kind === 'background');
}

function traitEntries(pack: CompiledContentPack): readonly TraitContentEntry[] {
  return pack.entries.filter((entry): entry is TraitContentEntry => entry.kind === 'trait');
}

export function BackgroundTraitsStep({ state, pack, dispatch }: StepProps): JSX.Element {
  const backgrounds = backgroundEntries(pack);
  const traits = traitEntries(pack);
  const backgroundNav = useListNavigation(backgrounds.length);
  const traitNav = useListNavigation(traits.length);

  return (
    <section aria-label="Background and traits" className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Background</legend>
        <div
          role="listbox"
          aria-label="Background"
          className="flex flex-col gap-1.5"
          onKeyDown={backgroundNav.handleArrowKeys}
        >
          {backgrounds.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={state.backgroundId === entry.id}
              ref={backgroundNav.registerItem(index)}
              className={cn(OPTION_BUTTON_CLASS, index === backgroundNav.selectedIndex && OPTION_SELECTED_CLASS)}
              onClick={() => dispatch({ type: 'choose-background', backgroundId: entry.id })}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium text-fg">{`Traits (${state.traitIds.length}/2)`}</legend>
        <div role="listbox" aria-label="Traits" aria-multiselectable="true" className="flex flex-col gap-1.5" onKeyDown={traitNav.handleArrowKeys}>
          {traits.map((entry, index) => {
            const selected = state.traitIds.includes(entry.id);
            const atCap = !selected && state.traitIds.length >= 2;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-disabled={atCap}
                ref={traitNav.registerItem(index)}
                className={cn(
                  OPTION_BUTTON_CLASS,
                  index === traitNav.selectedIndex && OPTION_SELECTED_CLASS,
                  selected && 'border-accent',
                )}
                onClick={() => dispatch({ type: 'toggle-trait', traitId: entry.id })}
              >
                {entry.name}
              </button>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

export function SummaryStep({ state, pack }: StepProps): JSX.Element {
  const classEntry = classEntries(pack).find((entry) => entry.id === state.classId);
  const kit = classEntry?.kits.find((candidate) => candidate.kitId === state.kitId);
  const background = backgroundEntries(pack).find((entry) => entry.id === state.backgroundId);
  const chosenTraits = traitEntries(pack).filter((entry) => state.traitIds.includes(entry.id));

  return (
    <section aria-label="Summary" className="flex flex-col gap-3">
      <h2 className="m-0 font-serif text-2xl text-accent-strong">{state.name}</h2>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted">
        <li>{`Method: ${state.method ?? '—'}`}</li>
        <li>{`Class: ${classEntry?.name ?? '—'}`}</li>
        <li>{`Kit: ${kit?.name ?? '—'}`}</li>
        <li>{`Background: ${background?.name ?? '—'}`}</li>
        <li>{`Traits: ${chosenTraits.length > 0 ? chosenTraits.map((trait) => trait.name).join(', ') : 'None'}`}</li>
      </ul>
      <AttributeReadout state={state} />
      <PreviewPanel state={state} pack={pack} />
    </section>
  );
}
