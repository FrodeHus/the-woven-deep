import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ATTRIBUTE_ORDER, pointBuyCost, type AttributeName } from '@woven-deep/engine';
import { Button } from '@/ui/components/button.js';
import { ATTRIBUTE_ABBREVIATIONS, ATTRIBUTE_LABELS } from '@/ui/derived-stats-display.js';
import { balanceEntry } from '../../../../session/pack-queries.js';
import { BlockBar } from '../chargen-components.js';
import { AttributeStepper } from '../AttributeStepper.js';
import { useListNavigation } from '../../roving-focus.js';
import { OPTION_SELECTED_CLASS, type StepProps } from './step-content.js';
import { cn } from '@/ui/lib/cn.js';

const METHOD_OPTIONS = [
  { method: 'point-buy' as const, label: 'POINT-BUY' },
  { method: 'roll' as const, label: 'ROLL 3D6' },
];

function AttributeReadout({ state }: { readonly state: StepProps['state'] }): JSX.Element {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm text-muted">
      {ATTRIBUTE_ORDER.map((attributeName) => (
        <li
          key={attributeName}
        >{`${attributeName}: ${state.attributes?.[attributeName] ?? '—'}`}</li>
      ))}
    </ul>
  );
}

function RollAttributes({ state, dispatch }: StepProps): JSX.Element {
  if (state.attributes === null) {
    return (
      <Button
        type="button"
        autoFocus
        className="self-start"
        onClick={() => dispatch({ type: 'roll' })}
      >
        Roll attributes
      </Button>
    );
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

  const costFor = (value: number): number =>
    balance?.pointBuy.costs.find((row) => row.value === value)?.cost ?? 0;

  const attemptSpent = (attributeName: AttributeName, value: number): number => {
    if (!balance || !state.attributes) return 0;
    return pointBuyCost({ ...state.attributes, [attributeName]: value }, balance.pointBuy);
  };

  const adjust = (attributeName: AttributeName, delta: number): void => {
    if (!state.attributes) return;
    dispatch({
      type: 'set-attribute',
      attribute: attributeName,
      value: state.attributes[attributeName] + delta,
    });
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
              abbr={ATTRIBUTE_ABBREVIATIONS[attributeName]}
              label={ATTRIBUTE_LABELS[attributeName]}
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
      <div
        role="listbox"
        aria-label="Attribute method"
        className="flex flex-row gap-1.5 font-mono"
        onKeyDown={handleKeyDown}
      >
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
      {state.method === 'point-buy' && (
        <PointBuyAttributes state={state} pack={pack} dispatch={dispatch} />
      )}
    </section>
  );
}
