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
    /** Never selectable here; renders with an unlock hint and a dashed "locked forever" treatment. */
    locked?: boolean;
    lockHint?: string;
    /** Currently unselectable (e.g. a selection cap is reached) but not permanently locked;
     * renders with a plain "unavailable right now" treatment and no unlock-hint affordance.
     * When both `locked` and `disabled` are set, `locked` wins. */
    disabled?: boolean;
    disabledReason?: string;
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
    disabled,
    disabledReason,
    onSelect,
  },
  ref,
) {
  const effectiveDisabled = !locked && disabled;
  const inactive = locked || effectiveDisabled;

  const markerText = locked
    ? '⊘'
    : effectiveDisabled
      ? '–'
      : marker === 'single'
        ? selected
          ? '(•)'
          : '( )'
        : selected
          ? '[×]'
          : '[ ]';

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (inactive) return;
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
      aria-disabled={inactive || undefined}
      tabIndex={-1}
      onClick={inactive ? undefined : onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex items-start gap-3 rounded border p-2 font-mono',
        locked
          ? 'cursor-not-allowed border-dashed border-line opacity-60'
          : effectiveDisabled
            ? 'cursor-not-allowed border-line opacity-40'
            : 'cursor-pointer border-line',
        selected && !inactive ? 'border-accent bg-raised' : undefined,
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
        {effectiveDisabled && disabledReason ? (
          <span className="text-subtle">{disabledReason}</span>
        ) : null}
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
