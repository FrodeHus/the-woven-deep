import type { JSX } from 'react';
import type { EquipmentSlot } from '@woven-deep/engine';
import { cn } from '../lib/cn.js';
import { CATEGORY_GLYPH, type ProjectedItemLike } from './inventory-model.js';

/** The nine real equipment slots the engine's `EquipmentSlot` union defines
 * (`packages/engine/src/actor-model.ts`), in a fixed, sensible presentation order -- never
 * invented ("weapon/armor/shield/light/ring/amulet" is loose brief shorthand for these). */
const SLOT_ORDER: readonly EquipmentSlot[] = [
  'head',
  'neck',
  'main-hand',
  'body',
  'off-hand',
  'hands',
  'left-ring',
  'right-ring',
  'feet',
];

const SLOT_LABEL: Readonly<Record<EquipmentSlot, string>> = {
  'main-hand': 'Main hand',
  'off-hand': 'Off hand',
  body: 'Body',
  head: 'Head',
  hands: 'Hands',
  feet: 'Feet',
  neck: 'Neck',
  'left-ring': 'Left ring',
  'right-ring': 'Right ring',
};

export function EquipmentSlots({
  equipment,
}: Readonly<{ equipment: Readonly<Record<string, ProjectedItemLike | null>> }>): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1.5 text-xs">
      {SLOT_ORDER.map((slot) => {
        const item = equipment[slot] ?? null;
        return (
          <div
            key={slot}
            className={cn(
              'flex min-h-[2.375rem] flex-col gap-0.5 border border-line px-2 py-1',
              item ? 'bg-raised' : 'bg-surface',
            )}
          >
            <span className="text-[10px] uppercase tracking-[0.08em] text-subtle">
              {SLOT_LABEL[slot]}
            </span>
            <span className="truncate font-mono text-fg">
              {item ? `${CATEGORY_GLYPH[item.category]} ${item.name}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
