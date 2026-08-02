import type { JSX } from 'react';
import { ATTRIBUTE_ORDER, type AttributeName, type GameplayProjection } from '@woven-deep/engine';
import { heroOf } from '../../session/projection-view.js';
import { ATTRIBUTE_LABELS, ATTRIBUTE_ABBREVIATIONS } from '../derived-stats-display.js';

export interface TemperOverlayProps {
  readonly projection: GameplayProjection;
  readonly onTemper: (attribute: AttributeName) => void;
  readonly onClose: () => void;
}

/**
 * The temper choice UI: a small console-styled overlay, built on the chargen attribute row's own
 * markup and theme tokens (`AttributeStepper`'s `w-10` abbreviation column, `font-mono` layout,
 * `text-fg`/`text-subtle`/`text-accent` tones -- no new colour literal). One row per attribute,
 * each a single-click "spend a banked point here" button rather than an increment/decrement
 * stepper (chargen's stepper spends build points during creation; tempering spends a fixed,
 * already-earned point on a single choice). A row is disabled whenever `hero.tempering` doesn't
 * offer it: no point banked at all, or the attribute already sits at the authored maximum
 * (`temperable` -- computed engine-side, never re-derived here).
 *
 * Reads `projection`/dispatches through `onTemper` as plain props (mirrors `DialogueScreen`'s
 * shape) rather than session context, so it stays independently testable without a full session
 * mount.
 */
export function TemperOverlay({
  projection,
  onTemper,
  onClose,
}: Readonly<TemperOverlayProps>): JSX.Element {
  const hero = heroOf(projection);
  const { banked, temperable } = hero.tempering;
  const heldByTheDeep = banked > 0 && temperable.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="font-mono text-sm text-fg">
        {banked} {banked === 1 ? 'point' : 'points'} banked
      </p>
      {heldByTheDeep && <p className="text-sm italic text-subtle">Held by the Deep.</p>}
      <div className="flex flex-col gap-2">
        {ATTRIBUTE_ORDER.map((name) => {
          const disabled = banked <= 0 || !temperable.includes(name);
          return (
            <div key={name} className="flex items-center gap-3 font-mono">
              <span className="w-10 shrink-0 text-fg-strong">{ATTRIBUTE_ABBREVIATIONS[name]}</span>
              <span className="flex-1 text-fg">{ATTRIBUTE_LABELS[name]}</span>
              <span className="text-subtle">{hero.attributes[name]}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onTemper(name)}
                className={
                  disabled
                    ? 'cursor-not-allowed border border-subtle px-3 py-1.5 text-xs text-subtle'
                    : 'cursor-pointer border border-accent px-3 py-1.5 text-xs text-accent-strong hover:bg-accent hover:text-deep'
                }
              >
                {ATTRIBUTE_LABELS[name]}
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="cursor-pointer self-start border border-line px-3 py-1.5 font-mono text-xs text-muted hover:border-accent hover:text-fg"
      >
        Close
      </button>
    </div>
  );
}
