import type { JSX } from 'react';

/** The engine's four hunger stages, in draining order. */
export type HungerStageName = 'sated' | 'hungry' | 'weak' | 'starving';

/**
 * How full the reserve column reads at each stage, and the tone it reads in.
 *
 * The projection exposes only `hero.hungerStage`, never the numeric reserve behind it (see
 * `projectHeroView` in the engine), so this is a stage indicator wearing a gauge's clothes: the
 * fractions are fixed presentation steps, not measured values. A continuously draining column would
 * need the reserve projected, which is an engine change and out of scope here.
 */
const STAGE_PRESENTATION: Readonly<
  Record<
    HungerStageName,
    { readonly fraction: number; readonly color: string; readonly pulse: boolean }
  >
> = {
  sated: { fraction: 1, color: 'var(--color-muted)', pulse: false },
  hungry: { fraction: 0.6, color: 'var(--color-warn)', pulse: false },
  weak: { fraction: 0.3, color: 'var(--color-accent)', pulse: false },
  starving: { fraction: 0.1, color: 'var(--color-danger)', pulse: true },
};

const COLUMN_HEIGHT_PX = 44;

/**
 * A quiet provisions indicator for the action bar, sitting beside the life-thread and weave dials:
 * a slim vertical column whose fill drops stage by stage and warms from muted through amber to a
 * pulsing danger red at `starving`. Deliberately smaller and duller than the dials -- hunger is a
 * slow pressure, not a moment-to-moment read, so it must never compete with health.
 *
 * Purely presentational: stage in, markup out, no session access.
 */
export function ProvisionsMeter({ stage }: Readonly<{ stage: string }>): JSX.Element {
  const presentation = STAGE_PRESENTATION[stage as HungerStageName] ?? STAGE_PRESENTATION.sated;

  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid="provisions-meter"
      data-stage={stage}
      role="img"
      aria-label={`Provisions: ${stage}`}
    >
      <span className="font-mono text-[0.5rem] uppercase tracking-[0.2em] text-subtle">FED</span>
      <div
        aria-hidden="true"
        className="flex w-1.5 flex-col justify-end overflow-hidden rounded-full border border-line bg-deep/60"
        style={{ height: `${COLUMN_HEIGHT_PX}px` }}
      >
        <div
          data-testid="provisions-fill"
          className={presentation.pulse ? 'w-full motion-safe:animate-pulse' : 'w-full'}
          style={{
            height: `${Math.round(presentation.fraction * 100)}%`,
            backgroundColor: presentation.color,
          }}
        />
      </div>
    </div>
  );
}
