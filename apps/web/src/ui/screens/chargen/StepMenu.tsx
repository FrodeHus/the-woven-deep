import type { JSX } from 'react';
import { HERO_NAME_RULES } from '@woven-deep/engine';
import { cn } from '@/ui/lib/cn.js';
import type { WizardState } from '../../../session/wizard-reducer.js';
import { useListNavigation } from '../roving-focus.js';

export const STEP_LABELS: Readonly<Record<WizardState['step'], string>> = {
  1: 'Identity',
  2: 'Calling',
  3: 'Kit',
  4: 'Attributes',
  5: 'Origin',
  6: 'Traits',
  7: 'Review',
};

const METHOD_LABELS: Readonly<Record<string, string>> = {
  'point-buy': 'POINT-BUY',
  roll: 'ROLL 3D6',
};

const STEPS: readonly WizardState['step'][] = [1, 2, 3, 4, 5, 6, 7];

function isNameValid(name: string): boolean {
  return (
    name.length >= HERO_NAME_RULES.minLength
    && name.length <= HERO_NAME_RULES.maxLength
    && HERO_NAME_RULES.pattern.test(name)
  );
}

/** Whether a given step's own field has been chosen -- drives that row's status dot. Step 7
 * (Review) has no field of its own, so it reuses the "everything earlier is satisfied" check. */
function stepIsSet(step: WizardState['step'], state: WizardState): boolean {
  switch (step) {
    case 1: return isNameValid(state.name);
    case 2: return state.classId !== null;
    case 3: return state.kitId !== null;
    case 4: return state.attributes !== null;
    case 5: return state.backgroundId !== null;
    case 6: return true;
    case 7: return STEPS.slice(0, 6).every((earlier) => stepIsSet(earlier, state));
  }
}

/** A step is reachable only if every earlier step is satisfied -- this is what guards `onJump`
 * against skipping ahead of an unfinished step by clicking. */
function stepIsReachable(step: WizardState['step'], state: WizardState): boolean {
  return STEPS.filter((candidate) => candidate < step).every((earlier) => stepIsSet(earlier, state));
}

function currentValue(step: WizardState['step'], state: WizardState): string {
  switch (step) {
    case 1: return state.name || '—';
    case 2: return state.classId ?? '—';
    case 3: return state.kitId ?? '—';
    case 4: return state.method ? (METHOD_LABELS[state.method] ?? state.method) : '—';
    case 5: return state.backgroundId ?? '—';
    case 6: return `${state.traitIds.length}/2 traits`;
    case 7: return '—';
  }
}

export function StepMenu({
  state, current, onJump,
}: {
  readonly state: WizardState;
  readonly current: WizardState['step'];
  readonly onJump: (step: WizardState['step']) => void;
}): JSX.Element {
  const { registerItem, handleArrowKeys } = useListNavigation(STEPS.length);

  const attemptJump = (step: WizardState['step']): void => {
    if (!stepIsReachable(step, state)) return;
    onJump(step);
  };

  return (
    <nav aria-label="Build order" className="flex flex-col gap-0.5 font-mono">
      <div role="listbox" aria-label="Build order" className="flex flex-col gap-0.5" onKeyDown={handleArrowKeys}>
        {STEPS.map((step, index) => {
          const active = step === current;
          const set = stepIsSet(step, state);
          return (
            <button
              key={step}
              type="button"
              role="option"
              aria-selected={active}
              ref={registerItem(index)}
              className={cn(
                'flex flex-col items-start gap-0.5 rounded-md border border-transparent px-2 py-1 text-left text-sm hover:bg-raised',
                active && 'border-accent bg-raised',
              )}
              onClick={() => attemptJump(step)}
            >
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="w-3 text-accent">{active ? '›' : ''}</span>
                <span className="text-muted">{String(step).padStart(2, '0')}</span>
                <span className={active ? 'text-fg-strong' : 'text-fg'}>{STEP_LABELS[step]}</span>
                <span aria-hidden="true" className={set ? 'text-good' : 'text-subtle'}>{set ? '●' : '○'}</span>
              </span>
              <span className="pl-9 text-xs text-muted">{currentValue(step, state)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
