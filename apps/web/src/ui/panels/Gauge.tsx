import type { JSX } from 'react';

export interface GaugeProps {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly tone: 'hp' | 'weave';
}

const RADIUS = 44;
const STROKE = 8;
const CENTER = 50;
/** The dial sweeps 270° (three quarters of a circle), leaving a 90° gap open at the bottom --
 * starting at 135° (down-left) and ending at 45° (down-right), both measured in the SVG's
 * y-down coordinate system where 0° points right and 90° points down. */
const START_DEG = 135;
const SWEEP_DEG = 270;
/** Below this health fraction, `Gauge` swaps the hp dial to the danger color and pulses it. */
const HP_DANGER_THRESHOLD = 0.25;

function pointOnArc(angleDeg: number): Readonly<{ x: number; y: number }> {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CENTER + RADIUS * Math.cos(rad), y: CENTER + RADIUS * Math.sin(rad) };
}

/** The dial arc's `d` attribute for the given fraction (0..1) of the full 270° sweep -- `undefined`
 * for a non-positive fraction, since a zero-length arc path draws nothing anyway. */
function arcPath(fraction: number): string | undefined {
  const clamped = Math.max(0, Math.min(1, fraction));
  if (clamped <= 0) return undefined;
  const sweep = SWEEP_DEG * clamped;
  const start = pointOnArc(START_DEG);
  const end = pointOnArc(START_DEG + sweep);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${RADIUS} ${RADIUS} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

const TRACK_PATH = arcPath(1);

const MICRO_LABEL: Readonly<Record<GaugeProps['tone'], string>> = {
  hp: 'LIFE-THREAD',
  weave: 'WEAVE',
};

/**
 * A vitals dial for the action bar: an SVG arc (270° sweep, a 90° gap at the bottom) tracking
 * `value/max`, with the microlabel (`LIFE-THREAD`/`WEAVE`) above it and the raw numbers below.
 * The hp dial pulses in the danger color once health drops below 25%; the weave dial always
 * reads in its own cool tone. Purely presentational -- no interaction, no session access.
 */
export function Gauge({ label, value, max, tone }: GaugeProps): JSX.Element {
  const fraction = max > 0 ? value / max : 0;
  const danger = tone === 'hp' && fraction < HP_DANGER_THRESHOLD;
  const strokeColor = danger
    ? 'var(--color-danger)'
    : tone === 'hp'
      ? 'var(--color-good)'
      : 'var(--color-cool)';

  return (
    <div
      className="flex flex-col items-center gap-1"
      data-testid={`gauge-${tone}`}
      role="img"
      aria-label={`${label}: ${value} of ${max}`}
    >
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-subtle">
        {MICRO_LABEL[tone]}
      </span>
      <svg viewBox="0 0 100 100" width={88} height={88} aria-hidden="true">
        <path
          d={TRACK_PATH}
          fill="none"
          stroke="var(--color-line)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        <path
          d={arcPath(fraction)}
          fill="none"
          stroke={strokeColor}
          strokeWidth={STROKE}
          strokeLinecap="round"
          className={danger ? 'motion-safe:animate-pulse' : undefined}
        />
      </svg>
      <span className="font-mono text-xs text-fg">{`${value} / ${max}`}</span>
    </div>
  );
}
