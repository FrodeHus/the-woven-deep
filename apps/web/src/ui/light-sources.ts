import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, OpaqueId } from '@woven-deep/engine';

/**
 * Client-side light-source resolvers shared by `EffectsLayer` (the hero's carried-light glow) and
 * `LightCanvas` (Task 6's visibility-polygon lighting). Both consumers read the SAME hero light,
 * and `LightCanvas` additionally needs vault-authored fixture lights -- this module is the one
 * place either fact is derived, so the two can never drift.
 *
 * `equippedLightSource` was originally private to `EffectsLayer.tsx` (`:41-59`); extracted here
 * verbatim (same inputs, same outputs, same behavior) so `LightCanvas` can reuse it without
 * `EffectsLayer` importing from a sibling UI component.
 */
export interface EquippedLight {
  readonly contentId: OpaqueId;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly fuelFraction: number;
  /** The light item's authored peak brightness (0-255, same scale as a vault fixture's
   * `strength`) -- absent from the original `EffectsLayer`-only shape, added here purely so
   * `LightCanvas` can scale its gradient's peak alpha the same way it scales a fixture's. Extra
   * field, so `EffectsLayer`'s existing destructuring (`color`/`radius`/`fuelFraction`) is
   * unaffected -- zero behavior change there. */
  readonly strength: number;
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
      strength: entry.light.strength,
    };
  }
  return undefined;
}

/** A single vault-authored fixture light, positioned at the floor cell it occupies. */
export interface FixtureLight {
  readonly x: number;
  readonly y: number;
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
}

interface FixtureLightSpec {
  readonly color: readonly [number, number, number];
  readonly radius: number;
  readonly strength: number;
}

/** Every fixture-light spec a vault legend can place, keyed by `presentationToken` -- the same
 * lookup `HelpOverlay.tsx`'s `collectLightFixtures` builds for the glyph legend, generalized here
 * so `LightCanvas` can resolve the SAME spec by the SAME token without re-deriving it. */
function fixtureLightSpecs(pack: CompiledContentPack): ReadonlyMap<string, FixtureLightSpec> {
  const specs = new Map<string, FixtureLightSpec>();
  for (const entry of pack.entries) {
    if (entry.kind !== 'vault') continue;
    for (const legendEntry of Object.values(entry.legend)) {
      const light = legendEntry.light;
      if (!light || !light.enabled) continue;
      if (specs.has(light.presentationToken)) continue;
      specs.set(light.presentationToken, { color: light.color, radius: light.radius, strength: light.strength });
    }
  }
  return specs;
}

/**
 * Every vault fixture light currently visible to the hero: one entry per `projection.floor.cells`
 * fixture cell whose `knowledge === 'visible'` (a remembered-but-not-currently-seen fixture is
 * excluded -- its light isn't reaching the hero's eyes right now, matching the same
 * visible-vs-remembered discipline the rest of the canvas honors), resolved against the pack's
 * vault legends by `cell.fixture.token`. A fixture cell whose token has no matching legend spec
 * (should not happen for authored content, but no engine change means this stays defensive) is
 * silently skipped rather than throwing.
 */
export function fixtureLightsFor(
  projection: GameplayProjection, pack: CompiledContentPack,
): readonly FixtureLight[] {
  const specs = fixtureLightSpecs(pack);
  const lights: FixtureLight[] = [];
  for (const cell of projection.floor.cells) {
    if (cell.knowledge !== 'visible' || !cell.fixture) continue;
    const spec = specs.get(cell.fixture.token as unknown as string);
    if (!spec) continue;
    lights.push({ x: cell.x, y: cell.y, color: spec.color, radius: spec.radius, strength: spec.strength });
  }
  return lights;
}
