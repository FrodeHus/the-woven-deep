import { BlockBar } from './chargen-components.js';

export function AttributeStepper({
  abbr,
  abbrColor,
  label,
  cost,
  value,
  max,
  canDecrement,
  canIncrement,
  onDecrement,
  onIncrement,
}: {
  abbr: string;
  abbrColor?: string;
  label: string;
  cost: number;
  value: number;
  max: number;
  canDecrement: boolean;
  canIncrement: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}) {
  return (
    <div className="flex items-center gap-3 font-mono">
      <span
        className="w-10 shrink-0 text-fg-strong"
        style={abbrColor ? { color: abbrColor } : undefined}
      >
        {abbr}
      </span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-fg">{label}</span>
          <span className="text-subtle">{cost} pts</span>
        </span>
        <BlockBar value={value} max={max} cells={max} {...(abbrColor ? { color: abbrColor } : {})} />
      </span>
      <button
        type="button"
        aria-label="−"
        onClick={canDecrement ? onDecrement : undefined}
        disabled={!canDecrement}
        className="h-6 w-6 rounded border border-line text-fg disabled:opacity-40"
      >
        −
      </button>
      <span className="w-6 text-center text-fg-strong">{value}</span>
      <button
        type="button"
        aria-label="+"
        onClick={canIncrement ? onIncrement : undefined}
        disabled={!canIncrement}
        className="h-6 w-6 rounded border border-line text-fg disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
