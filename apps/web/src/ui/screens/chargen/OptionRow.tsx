import { forwardRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '@/ui/lib/cn.js';

export const OptionRow = forwardRef<
  HTMLDivElement,
  {
    glyph?: string;
    glyphColor?: string;
    name: string;
    meta?: string;
    description?: string;
    tags?: readonly string[];
    marker: 'single' | 'multi';
    selected: boolean;
    locked?: boolean;
    lockHint?: string;
    onSelect: () => void;
  }
>(function OptionRow(
  {
    glyph,
    glyphColor,
    name,
    meta,
    description,
    tags,
    marker,
    selected,
    locked,
    lockHint,
    onSelect,
  },
  ref,
) {
  const markerText = locked
    ? '⊘'
    : marker === 'single'
      ? selected
        ? '(•)'
        : '( )'
      : selected
        ? '[×]'
        : '[ ]';

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (locked) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      aria-disabled={locked || undefined}
      tabIndex={-1}
      onClick={locked ? undefined : onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex items-start gap-3 rounded border p-2 font-mono',
        locked
          ? 'cursor-not-allowed border-dashed border-line opacity-60'
          : 'cursor-pointer border-line',
        selected && !locked ? 'border-accent bg-raised' : undefined,
      )}
    >
      <span className="text-fg-strong">{markerText}</span>
      {glyph ? (
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-line text-lg"
          style={glyphColor ? { color: glyphColor } : undefined}
        >
          {glyph}
        </span>
      ) : null}
      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-fg-strong">{name}</span>
          {meta ? <span className="text-muted">{meta}</span> : null}
        </span>
        {locked && lockHint ? <span className="text-subtle">{lockHint}</span> : null}
        {description ? <span className="text-muted">{description}</span> : null}
        {tags && tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded border border-line px-1.5 py-0.5 text-xs text-muted"
              >
                {tag}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
});
