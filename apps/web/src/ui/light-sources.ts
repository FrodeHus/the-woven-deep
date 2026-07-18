import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, OpaqueId } from '@woven-deep/engine';

/** Client-side light-source resolver used by `EffectsLayer` for the hero's carried-light glow. */
export interface EquippedLight {
  readonly contentId: OpaqueId;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly fuelFraction: number;
}

/** Resolves the hero's currently equipped, enabled light source (if any) from their equipment and
 * the compiled content pack -- `undefined` when no equipped item carries an enabled light. */
export function equippedLightSource(
  projection: GameplayProjection, pack: CompiledContentPack,
): EquippedLight | undefined {
  const hero = projection.hero as unknown as {
    equipment: Readonly<Record<string, Readonly<{
      contentId?: OpaqueId; enabled?: boolean; fuel?: number;
    }> | null>>;
  };
  for (const item of Object.values(hero.equipment)) {
    if (!item || !item.enabled || item.contentId === undefined) continue;
    const entry = pack.entries.find((candidate) => candidate.id === item.contentId);
    if (entry?.kind !== 'item' || !entry.light) continue;
    const fuelFraction = entry.light.fuelCapacity > 0
      ? Math.max(0, Math.min(1, (item.fuel ?? 0) / entry.light.fuelCapacity))
      : 0;
    return {
      contentId: item.contentId,
      color: entry.light.color,
      radius: entry.light.radius,
      fuelFraction,
    };
  }
  return undefined;
}
