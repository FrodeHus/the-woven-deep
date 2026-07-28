import type { JSX } from 'react';
import { heroOf } from '../../session/projection-view.js';
import type { PanelProps } from './types.js';

/**
 * The full-bleed HUD's top bar: an absolute gradient overlay across the top of the playfield with
 * the game title (serif, wide letter-spacing), the current location (town or `DEPTH N`), the hero's
 * carried gold in the accent color, and the muted turn count. Purely a read-only heads-up display,
 * so the whole bar is `pointer-events-none` -- clicks fall through to the playfield beneath it.
 * The location string reuses the same town/depth logic the retired `StatusBar` used, rendered in the
 * design's uppercase style.
 */
export function TopBar({ snapshot }: PanelProps): JSX.Element {
  const { floor, metrics } = snapshot.projection;
  const hero = heroOf(snapshot.projection);
  const location = floor.town ? 'Town' : `DEPTH ${floor.depth}`;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-baseline gap-5 bg-gradient-to-b from-black/85 to-transparent px-4 pb-10 pt-3 text-sm">
      <span className="font-serif tracking-[0.24em] text-fg-strong">THE WOVEN DEEP</span>
      <span
        className="font-mono uppercase tracking-[0.16em] text-muted"
        data-testid="top-bar-location"
      >
        {location}
      </span>
      <span className="ml-auto font-mono text-accent" data-testid="top-bar-gold">
        {`⛁ ${hero.currency} gold`}
      </span>
      <span className="font-mono text-muted" data-testid="turn-count">
        {`Turn ${metrics.turnsElapsed}`}
      </span>
    </div>
  );
}
