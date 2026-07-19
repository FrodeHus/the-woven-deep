import type { JSX } from 'react';
import type { EquipmentSlot } from '@woven-deep/engine';
import { cn } from '../lib/cn.js';
import { CATEGORY_GLYPH, type ProjectedItemLike } from './inventory-model.js';

/** The nine real equipment slots the engine's `EquipmentSlot` union defines
 * (`packages/engine/src/actor-model.ts`), in a fixed, sensible presentation order -- never
 * invented ("weapon/armor/shield/light/ring/amulet" is loose brief shorthand for these). */
const SLOT_ORDER: readonly EquipmentSlot[] = [
  'main-hand', 'off-hand', 'body', 'head', 'hands', 'feet', 'neck', 'left-ring', 'right-ring',
];

const SLOT_LABEL: Readonly<Record<EquipmentSlot, string>> = {
  'main-hand': 'Main hand', 'off-hand': 'Off hand', body: 'Body', head: 'Head', hands: 'Hands',
  feet: 'Feet', neck: 'Neck', 'left-ring': 'Left ring', 'right-ring': 'Right ring',
};

export function EquipmentSlots({ equipment }: Readonly<{ equipment: Readonly<Record<string, ProjectedItemLike | null>> }>): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-md border border-line bg-surface p-2 text-xs">
      {SLOT_ORDER.map((slot) => {
        const item = equipment[slot] ?? null;
        return (
          <div key={slot} className={cn('flex flex-col gap-0.5 rounded-sm px-1 py-0.5', item && 'bg-raised')}>
            <span className="text-muted">{SLOT_LABEL[slot]}</span>
            <span className="font-mono text-fg">
              {item ? `${CATEGORY_GLYPH[item.category]} ${item.name}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}
