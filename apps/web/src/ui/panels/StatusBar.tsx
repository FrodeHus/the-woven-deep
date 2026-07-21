import type { CSSProperties, JSX } from 'react';
import { pickPrimaryCondition } from '../effects-map.js';
import { hero, type PanelProps } from './types.js';

/** The colorblind-safe condition badge: a generic status-effect glyph PLUS the condition's name as
 * text -- so meaning never rests on color alone, even though the badge is also tinted via
 * `--condition-color` for a sighted-color reader. */
export function StatusBar({ snapshot }: PanelProps): JSX.Element {
  const heroData = hero(snapshot);
  const { metrics, floor } = snapshot.projection;
  const primaryCondition = pickPrimaryCondition(heroData.conditions);
  return (
    <div
      role="group"
      aria-label="Status"
      className="flex items-baseline gap-5 rounded-md border border-line bg-surface px-4 py-1.5 text-sm text-fg"
    >
      <span aria-hidden="true" className="font-serif tracking-[0.2em] text-fg-strong">
        THE WOVEN DEEP
      </span>
      <span aria-hidden="true" className="text-subtle">
        ❦
      </span>
      <span className="font-serif text-fg-strong">{heroData.name}</span>
      <span className="tracking-wide text-muted">
        {floor.town ? 'Town' : `Depth ${floor.depth}`}
      </span>
      <span className="ml-auto text-muted" data-testid="turn-count">{`Turn ${metrics.turnsElapsed}`}</span>
      {primaryCondition && (
        <span
          className="condition-badge rounded border px-1.5 text-xs"
          title={primaryCondition.name}
          style={
            {
              '--condition-color': primaryCondition.color,
              borderColor: 'var(--condition-color)',
            } as CSSProperties
          }
        >
          <span aria-hidden="true">{'✺'}</span>
          {` ${primaryCondition.name}`}
        </span>
      )}
    </div>
  );
}
