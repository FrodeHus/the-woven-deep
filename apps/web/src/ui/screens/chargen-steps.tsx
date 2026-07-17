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

/** Derived-stats preview panel, shown on the attributes step and the summary step. */
export function PreviewPanel({ state, pack }: { readonly state: WizardState; readonly pack: CompiledContentPack }): JSX.Element | null {
  const stats = wizardPreview(state, pack);
  if (!stats) return null;
  return (
    <section aria-label="Derived stats preview" className="chargen-preview">
      <h3>Derived stats</h3>
      <ul className="chargen-preview-list">
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
    <section aria-label="Name and portrait" className="chargen-step chargen-step--name">
      <label htmlFor="chargen-name">Name</label>
      <input
        id="chargen-name"
        type="text"
        value={state.name}
        maxLength={HERO_NAME_RULES.maxLength}
        onChange={(event) => dispatch({ type: 'set-name', name: event.target.value })}
        autoFocus
      />
      <fieldset>
        <legend>Portrait</legend>
        <div
          role="listbox"
          aria-label="Portrait"
          className="chargen-portrait-list"
          onKeyDown={handlePortraitKeyDown}
        >
          {PORTRAIT_GLYPHS.map((glyph, index) => (
            <button
              key={glyph}
              type="button"
              role="option"
              aria-selected={state.portraitGlyph === glyph}
              ref={registerItem(index)}
              className={
                index === selectedIndex
                  ? 'chargen-portrait chargen-portrait--focused'
                  : 'chargen-portrait'
              }
              data-glyph={glyph}
              onClick={() => dispatch({ type: 'set-portrait', glyph })}
            >
              <span className="chargen-portrait-glyph" data-glyph={glyph} aria-hidden="true">@</span>
            </button>
          ))}
        </div>
      </fieldset>
      <label className="chargen-onboarding-toggle">
        <input
          type="checkbox"
          checked={state.onboardingEnabled}
          onChange={(event) => dispatch({ type: 'set-onboarding-enabled', enabled: event.target.checked })}
        />
        Show guidance on your first delve
      </label>
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
    <section aria-label="Attribute method" className="chargen-step chargen-step--method">
      <div role="listbox" aria-label="Attribute method" className="chargen-option-list" onKeyDown={handleArrowKeys}>
        {METHOD_OPTIONS.map((option, index) => (
          <button
            key={option.method}
            type="button"
            role="option"
            aria-selected={state.method === option.method}
            ref={registerItem(index)}
            className={index === selectedIndex ? 'chargen-option chargen-option--focused' : 'chargen-option'}
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
    <ul className="chargen-attribute-list">
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
    <div className="chargen-point-buy">
      <p className="chargen-point-buy-budget">{`Points spent: ${spent}/${budget}`}</p>
      <div
        role="listbox"
        aria-label="Point-buy attributes"
        className="chargen-attribute-adjust-list"
        onKeyDown={handleKeyDown}
      >
        {ATTRIBUTE_ORDER.map((attributeName, index) => (
          <div
            key={attributeName}
            role="option"
            aria-selected={index === selectedIndex}
            tabIndex={-1}
            ref={registerItem(index)}
            className={index === selectedIndex ? 'chargen-attribute-row chargen-attribute-row--focused' : 'chargen-attribute-row'}
          >
            <span className="chargen-attribute-name">{attributeName}</span>
            <button type="button" aria-label={`Decrease ${attributeName}`} onClick={() => adjust(attributeName, -1)}>-</button>
            <span className="chargen-attribute-value">{state.attributes?.[attributeName] ?? 0}</span>
            <button type="button" aria-label={`Increase ${attributeName}`} onClick={() => adjust(attributeName, 1)}>+</button>
          </div>
        ))}
      </div>
      <p className="chargen-hints">↑↓ select attribute · ←→ adjust value</p>
    </div>
  );
}

export function AttributesStep({ state, pack, dispatch }: StepProps): JSX.Element {
  return (
    <section aria-label="Attributes" className="chargen-step chargen-step--attributes">
      {state.method === 'roll' && (
        <div className="chargen-roll">
          {state.attributes === null
            ? <button type="button" autoFocus onClick={() => dispatch({ type: 'roll' })}>Roll attributes</button>
            : (
              <>
                <AttributeReadout state={state} />
                <button type="button" disabled={state.rerollUsed} onClick={() => dispatch({ type: 'reroll' })}>
                  {state.rerollUsed ? 'Reroll used' : 'Reroll'}
                </button>
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
    <section aria-label="Class" className="chargen-step chargen-step--class">
      <div role="listbox" aria-label="Class" className="chargen-option-list" onKeyDown={handleKeyDown}>
        {entries.map((entry, index) => (
          <button
            key={entry.id}
            type="button"
            role="option"
            aria-selected={state.classId === entry.id}
            aria-disabled={!entry.playable}
            ref={registerItem(index)}
            disabled={!entry.playable}
            className={
              !entry.playable
                ? 'chargen-option chargen-option--locked'
                : index === selectedIndex
                  ? 'chargen-option chargen-option--focused'
                  : 'chargen-option'
            }
            onClick={() => { if (entry.playable) dispatch({ type: 'choose-class', classId: entry.id }); }}
          >
            <span className="chargen-class-glyph" aria-hidden="true">{entry.silhouetteGlyph}</span>
            <span className="chargen-class-name">{entry.name}</span>
            {!entry.playable && entry.unlockHint && (
              <span className="chargen-class-unlock-hint">{entry.unlockHint}</span>
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

  if (!classEntry) return <p className="placeholder">Choose a class first.</p>;

  return (
    <section aria-label="Kit" className="chargen-step chargen-step--kit">
      <div role="listbox" aria-label="Kit" className="chargen-option-list" onKeyDown={handleArrowKeys}>
        {kits.map((kit, index) => (
          <button
            key={kit.kitId}
            type="button"
            role="option"
            aria-selected={state.kitId === kit.kitId}
            ref={registerItem(index)}
            className={index === selectedIndex ? 'chargen-option chargen-option--focused' : 'chargen-option'}
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
    <section aria-label="Background and traits" className="chargen-step chargen-step--background">
      <fieldset>
        <legend>Background</legend>
        <div
          role="listbox"
          aria-label="Background"
          className="chargen-option-list"
          onKeyDown={backgroundNav.handleArrowKeys}
        >
          {backgrounds.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={state.backgroundId === entry.id}
              ref={backgroundNav.registerItem(index)}
              className={
                index === backgroundNav.selectedIndex ? 'chargen-option chargen-option--focused' : 'chargen-option'
              }
              onClick={() => dispatch({ type: 'choose-background', backgroundId: entry.id })}
            >
              {entry.name}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>{`Traits (${state.traitIds.length}/2)`}</legend>
        <div role="listbox" aria-label="Traits" aria-multiselectable="true" className="chargen-option-list" onKeyDown={traitNav.handleArrowKeys}>
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
                className={
                  index === traitNav.selectedIndex
                    ? 'chargen-option chargen-option--focused'
                    : 'chargen-option'
                }
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
    <section aria-label="Summary" className="chargen-step chargen-step--summary">
      <h2>{state.name}</h2>
      <ul className="chargen-summary-list">
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
