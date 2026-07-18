import type { JSX, KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface ListDetailItem {
  readonly id: string;
  readonly glyph?: string;
  readonly glyphColor?: string;
  readonly label: string;
  readonly badge?: string;
  readonly quantity?: number;
}

export interface ListDetailProps {
  readonly items: readonly ListDetailItem[];
  readonly renderDetail: (item: ListDetailItem | undefined, index: number) => ReactNode;
  readonly selectedIndex: number;
  readonly onSelect: (index: number) => void;
  readonly listLabel: string;
  readonly slots?: ReactNode;
  readonly toolbar?: ReactNode;
}

function optionId(listLabel: string, id: string): string {
  return `list-detail-option-${listLabel}-${id}`.replace(/\s+/g, '-');
}

export function ListDetail(props: Readonly<ListDetailProps>): JSX.Element {
  const { items, renderDetail, selectedIndex, onSelect, listLabel, slots, toolbar } = props;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (items.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        onSelect((selectedIndex + 1) % items.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        onSelect((selectedIndex - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        onSelect(0);
        break;
      case 'End':
        event.preventDefault();
        onSelect(items.length - 1);
        break;
      default:
        break;
    }
  }

  const activeItem = items[selectedIndex];
  const activeDescendant = activeItem ? optionId(listLabel, activeItem.id) : undefined;

  return (
    <div className="flex flex-col gap-2">
      {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
      {slots && <div className="flex flex-col gap-1">{slots}</div>}
      <div className="grid grid-cols-[1.05fr_1fr] gap-3">
        <div
          role="listbox"
          aria-label={listLabel}
          aria-activedescendant={activeDescendant}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="flex flex-col gap-0.5 rounded-md border border-line bg-surface p-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {items.map((item, index) => {
            const selected = index === selectedIndex;
            return (
              <div
                key={item.id}
                id={optionId(listLabel, item.id)}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(index)}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-1 text-sm font-sans text-fg',
                  selected && 'bg-raised border-accent',
                )}
              >
                {selected && (
                  <span aria-hidden="true" className="text-accent">
                    {'›'}
                  </span>
                )}
                {item.glyph && (
                  <span className="font-mono" style={item.glyphColor ? { color: item.glyphColor } : undefined}>
                    {item.glyph}
                  </span>
                )}
                <span className="flex-1">{item.label}</span>
                {item.quantity !== undefined && <span className="text-muted">{`x${item.quantity}`}</span>}
                {item.badge && <span className="text-xs text-muted">{item.badge}</span>}
              </div>
            );
          })}
        </div>
        <div
          role="region"
          aria-live="polite"
          aria-label={`${listLabel} detail`}
          className="rounded-md border border-line bg-surface p-2 text-fg"
        >
          {renderDetail(activeItem, selectedIndex)}
        </div>
      </div>
    </div>
  );
}
