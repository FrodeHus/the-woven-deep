import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface LedgerRow {
  readonly id: string;
  readonly glyph?: string;
  readonly name: string;
  readonly quantity?: number;
  /** Pre-formatted price label (e.g. `"45g"`); omitted for columns with no price (house). */
  readonly price?: string;
}

export interface LedgerListProps {
  readonly listLabel: string;
  readonly heading: string;
  readonly headingHint?: string;
  readonly rows: readonly LedgerRow[];
  readonly selectedIndex: number;
  /** Whether this column currently owns keyboard selection -- highlights the active side. */
  readonly active: boolean;
  readonly onSelect: (index: number) => void;
  readonly onAct: (index: number) => void;
  readonly actionLabel: string;
  readonly actionClassName: string;
  readonly priceClassName?: string;
  readonly emptyText: string;
}

/**
 * One side of a two-sided "ledger" (the trade Stock/Pack columns, the house Backpack/Chest columns):
 * a labelled column heading over a scrollable list of item rows, each row carrying an inline action
 * button (buy/sell/stow/take) that dispatches directly. Selection/keyboard is driven entirely by the
 * parent (which owns the focused-side + index state and the Tab/Arrow/Enter handling); this component
 * only renders and reports clicks. An empty column renders its placeholder text INSTEAD of an empty
 * listbox, so `queryByRole('listbox', { name })` is a faithful "this side has rows" probe.
 */
export function LedgerList(props: Readonly<LedgerListProps>): JSX.Element {
  const {
    listLabel,
    heading,
    headingHint,
    rows,
    selectedIndex,
    active,
    onSelect,
    onAct,
    actionLabel,
    actionClassName,
    priceClassName,
    emptyText,
  } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted">
        {heading}
        {headingHint && <span className="ml-1.5 text-subtle normal-case">{headingHint}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="p-3 text-sm text-subtle">{emptyText}</p>
      ) : (
        <div
          role="listbox"
          aria-label={listLabel}
          tabIndex={0}
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5 outline-none',
            active && 'ring-1 ring-inset ring-accent/40',
          )}
        >
          {rows.map((row, index) => {
            const selected = index === selectedIndex;
            return (
              <div
                key={row.id}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 border-l-2 border-transparent px-2 py-1.5 font-mono text-sm text-fg',
                  selected ? 'border-accent bg-raised' : 'hover:bg-raised/50',
                )}
              >
                {row.glyph && (
                  <span aria-hidden="true" className="w-3.5 text-center text-muted">
                    {row.glyph}
                  </span>
                )}
                <span className="flex-1 truncate">{row.name}</span>
                {row.quantity !== undefined && (
                  <span className="text-[0.6875rem] text-subtle">{`×${row.quantity}`}</span>
                )}
                {row.price !== undefined && (
                  <span
                    className={cn('min-w-11 text-right', priceClassName ?? 'text-accent-strong')}
                  >
                    {row.price}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAct(index);
                  }}
                  className={cn(
                    'cursor-pointer border bg-raised px-2 py-0.5 font-mono text-[0.6875rem]',
                    actionClassName,
                  )}
                >
                  {actionLabel}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A shared framed panel used as the center column of the trade ledger (merchant identity + purse +
 * services). Kept here beside `LedgerList` since both are the ledger's structural pieces. */
export function LedgerCenter({ children }: Readonly<{ children: ReactNode }>): JSX.Element {
  return (
    <div className="flex min-h-0 flex-col items-center gap-2.5 border-x border-line px-3 py-4 text-center">
      {children}
    </div>
  );
}
