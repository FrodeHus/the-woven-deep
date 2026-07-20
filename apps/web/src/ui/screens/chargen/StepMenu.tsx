import type { JSX } from 'react';
import type { ClassContentEntry, CompiledContentPack } from '@woven-deep/content';
import { cn } from '@/ui/lib/cn.js';
import { stepIsSatisfied, type WizardState } from '../../../session/wizard-reducer.js';
import { backgroundById, classById } from '../../../session/pack-queries.js';
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

/** Whether a given step's own field has been chosen -- drives that row's status dot. Step 7
 * (Review) has no field of its own, so it reuses the "everything earlier is satisfied" check.
 * Delegates to the reducer's `stepIsSatisfied` so this stays in sync with `next`'s gating. */
function stepIsSet(step: WizardState['step'], state: WizardState): boolean {
  if (step === 7) return STEPS.slice(0, 6).every((earlier) => stepIsSet(earlier, state));
  return stepIsSatisfied(state, step);
}

/** A step is reachable only if every earlier step is satisfied -- this is what guards `onJump`
 * against skipping ahead of an unfinished step by clicking. */
function stepIsReachable(step: WizardState['step'], state: WizardState): boolean {
  return STEPS.filter((candidate) => candidate < step).every((earlier) =>
    stepIsSet(earlier, state),
  );
}

function classEntryOf(
  pack: CompiledContentPack | undefined,
  classId: string | null,
): ClassContentEntry | undefined {
  if (classId === null || !pack) return undefined;
  return classById(pack, classId);
}

/** Resolves a step's current-value line to a human-readable NAME (class/kit/background), rather
 * than the raw content id (e.g. `class.wayfarer`) -- `pack` is optional so callers without one
 * (e.g. older tests) still get a sane, if less readable, fallback. */
function currentValue(
  step: WizardState['step'],
  state: WizardState,
  pack: CompiledContentPack | undefined,
): string {
  switch (step) {
    case 1:
      return state.name || '—';
    case 2: {
      if (state.classId === null) return '—';
      return classEntryOf(pack, state.classId)?.name ?? state.classId;
    }
    case 3: {
      if (state.kitId === null) return '—';
      const classEntry = classEntryOf(pack, state.classId);
      return classEntry?.kits.find((kit) => kit.kitId === state.kitId)?.name ?? state.kitId;
    }
    case 4:
      return state.method ? (METHOD_LABELS[state.method] ?? state.method) : '—';
    case 5: {
      if (state.backgroundId === null || !pack) return state.backgroundId ?? '—';
      const entry = backgroundById(pack, state.backgroundId);
      return entry?.name ?? state.backgroundId;
    }
    case 6:
      return `${state.traitIds.length}/2 traits`;
    case 7:
      return '—';
  }
}

export function StepMenu({
  state,
  current,
  onJump,
  pack,
}: {
  readonly state: WizardState;
  readonly current: WizardState['step'];
  readonly onJump: (step: WizardState['step']) => void;
  readonly pack?: CompiledContentPack;
}): JSX.Element {
  const { registerItem, handleArrowKeys } = useListNavigation(STEPS.length);

  const attemptJump = (step: WizardState['step']): void => {
    if (!stepIsReachable(step, state)) return;
    onJump(step);
  };

  return (
    <nav aria-label="Build order" className="flex flex-col gap-0.5 font-mono">
      <div
        role="listbox"
        aria-label="Build order"
        className="flex flex-col gap-0.5"
        onKeyDown={handleArrowKeys}
      >
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
                <span aria-hidden="true" className="w-3 text-accent">
                  {active ? '›' : ''}
                </span>
                <span className="text-muted">{String(step).padStart(2, '0')}</span>
                <span className={active ? 'text-fg-strong' : 'text-fg'}>{STEP_LABELS[step]}</span>
                <span aria-hidden="true" className={set ? 'text-good' : 'text-subtle'}>
                  {set ? '●' : '○'}
                </span>
              </span>
              <span className="pl-9 text-xs text-muted">{currentValue(step, state, pack)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
