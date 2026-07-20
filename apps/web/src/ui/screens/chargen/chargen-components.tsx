import { cn } from '@/ui/lib/cn.js';

export function BlockBar({
  value,
  max,
  cells,
  color,
}: {
  value: number;
  max: number;
  cells: number;
  color?: string;
}) {
  const n = Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
  return (
    <span aria-hidden className="whitespace-nowrap tracking-[1px] font-mono">
      <span className={color ? undefined : 'text-accent'} style={color ? { color } : undefined}>
        {'█'.repeat(n)}
      </span>
      <span className="text-subtle">{'█'.repeat(cells - n)}</span>
    </span>
  );
}

export function DotLeaderRow({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="flex items-center gap-2 font-mono">
      <span className="text-fg">{label}</span>
      <span className="flex-1 border-b border-dotted border-line" />
      <span className="text-fg-strong">
        {value}
        {delta ? (
          <span className={delta > 0 ? 'text-good' : 'text-danger'}>
            {' '}
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function TagChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 text-xs font-mono',
        selected ? 'bg-accent text-deep' : 'border border-line text-muted',
      )}
    >
      {label}
    </button>
  );
}
