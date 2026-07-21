import type { JSX } from 'react';
import { effectLabel } from '../labels.js';
import type { MenuEntry, ProjectedItemLike } from './inventory-model.js';

function ActionButton({
  label,
  chord,
  onClick,
}: Readonly<{ label: string; chord: string; onClick: () => void }>): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer border border-accent bg-raised px-3 py-1.5 font-mono text-xs text-accent-strong hover:bg-accent hover:text-deep"
    >
      {label} <span className="opacity-60">[{chord}]</span>
    </button>
  );
}

export function DetailPane({
  entry,
  refuelTarget,
  onEquip,
  onUse,
  onDrop,
  onToggleLight,
  onRefuel,
}: Readonly<{
  entry: MenuEntry | undefined;
  /** The equipped light `entry`'s item can refuel, if any -- see `equippedLightMatchingFuel`. */
  refuelTarget: ProjectedItemLike | undefined;
  onEquip: () => void;
  onUse: () => void;
  onDrop: () => void;
  onToggleLight: () => void;
  onRefuel: () => void;
}>): JSX.Element {
  if (!entry) return <p className="text-muted">Nothing selected.</p>;
  const { item, equipped, slot } = entry;
  const unidentified = item.contentId === undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <h3 className="font-serif text-lg text-fg-strong">{item.name}</h3>
        <div>
          <span className="border border-muted px-1.5 py-px text-[10px] uppercase tracking-[0.1em] text-muted">
            {`${item.category} · ${unidentified ? 'Unidentified' : 'Identified'} · Condition ${item.condition}`}
          </span>
        </div>
      </div>

      {equipped && <p className="text-sm">{`Equipped: ${slot}`}</p>}

      {!unidentified && item.effects && item.effects.length > 0 && (
        <div>
          <p className="text-sm font-medium">Effects</p>
          <ul className="text-sm text-muted">
            {item.effects.map((effect) => (
              <li key={effect.effectId}>{effectLabel(effect.effectId, effect.parameters)}</li>
            ))}
          </ul>
        </div>
      )}

      {item.enchantment && (
        <div>
          <p className="text-sm font-medium">Enchantment</p>
          <ul className="text-sm text-muted">
            {Object.entries(item.enchantment.modifiers).map(([stat, amount]) => (
              <li key={stat}>{`${stat}: ${amount >= 0 ? '+' : ''}${amount}`}</li>
            ))}
          </ul>
        </div>
      )}
      {item.unknownProperties && <p className="text-sm">Unknown properties</p>}

      {item.charges != null && <p className="text-sm">{`Charges: ${item.charges}`}</p>}
      {item.fuel != null && <p className="text-sm">{`Fuel: ${item.fuel}`}</p>}
      {item.enabled !== null && <p className="text-sm">{item.enabled ? 'Lit' : 'Unlit'}</p>}

      <div className="flex flex-wrap gap-2">
        <ActionButton label={equipped ? 'Unequip' : 'Equip'} chord="e" onClick={onEquip} />
        <ActionButton label="Use" chord="u" onClick={onUse} />
        <ActionButton label="Drop" chord="d" onClick={onDrop} />
        {item.category === 'light' && (
          <ActionButton label="Toggle light" chord="l" onClick={onToggleLight} />
        )}
        {refuelTarget && (
          <ActionButton label={`Refuel ${refuelTarget.name}`} chord="r" onClick={onRefuel} />
        )}
      </div>
    </div>
  );
}
