import type { JSX } from 'react';
import { HERO_NAME_RULES } from '@woven-deep/engine';
import { Button } from '@/ui/components/button.js';
import { Input } from '@/ui/components/input.js';
import { Label } from '@/ui/components/label.js';
import { cn } from '@/ui/lib/cn.js';
import {
  nameIsValid,
  PORTRAIT_GLYPHS,
  PORTRAIT_GLYPH_COLOR,
} from '../../../../session/wizard-reducer.js';
import { useListNavigation } from '../../roving-focus.js';
import { OPTION_SELECTED_CLASS, type StepProps } from './step-content.js';

const RANDOM_NAMES = ['Rin', 'Kael', 'Mira', 'Thane', 'Sable', 'Doran', 'Wren', 'Ysolde'] as const;

function pickRandomName(): string {
  const index = Math.floor(Math.random() * RANDOM_NAMES.length);
  return RANDOM_NAMES[index] ?? RANDOM_NAMES[0];
}

export function IdentityStep({ state, dispatch }: StepProps): JSX.Element {
  const { selectedIndex, registerItem, handleArrowKeys } = useListNavigation(
    PORTRAIT_GLYPHS.length,
  );
  const valid = nameIsValid(state.name);

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
          <Button
            type="button"
            variant="outline"
            onClick={() => dispatch({ type: 'set-name', name: pickRandomName() })}
          >
            {'⟳ RANDOM'}
          </Button>
        </div>
        <span className={cn('text-xs', valid ? 'text-muted' : 'text-danger')}>
          {valid ? `1-${HERO_NAME_RULES.maxLength} characters` : 'Name is invalid'}
        </span>
      </div>
      <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
        <legend className="text-sm font-medium text-fg">Portrait</legend>
        <div
          role="listbox"
          aria-label="Portrait"
          className="flex flex-row flex-wrap gap-2"
          onKeyDown={handleArrowKeys}
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
                index === selectedIndex && OPTION_SELECTED_CLASS,
              )}
              data-glyph={glyph}
              onClick={() => dispatch({ type: 'set-portrait', glyph })}
            >
              <span aria-hidden="true" style={{ color: PORTRAIT_GLYPH_COLOR[glyph] }}>
                @
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <Label className="flex items-center gap-2 text-sm text-fg">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-line accent-accent"
          checked={state.onboardingEnabled}
          onChange={(event) =>
            dispatch({ type: 'set-onboarding-enabled', enabled: event.target.checked })
          }
        />
        Show guidance on your first delve
      </Label>
    </section>
  );
}
