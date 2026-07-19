import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import type { CompiledContentPack } from '@woven-deep/content';
import type { GameplayProjection, OpaqueId, PublicEvent } from '@woven-deep/engine';
import { actorsOf, heroOf } from '../session/projection-view.js';
import type { CameraOrigin, CameraViewport } from './camera.js';
import {
  effectsForEvents, MAX_TRANSIENT_EFFECTS, pickPrimaryCondition, type TransientEffect,
} from './effects-map.js';
import { equippedLightSource } from './light-sources.js';

/**
 * NOTE: `viewport` is not part of the abbreviated JSX example in the task brief's Interfaces
 * section (`<EffectsLayer projection={...} pack={...} lastEvents={...} camera={...} />`), but that
 * same section's `GridRenderer` example likewise omits `viewport` even though `GridRenderer`
 * unquestionably needs it (see grid-renderer.test.tsx) — those snippets are elisions, not literal
 * prop lists. `EffectsLayer` needs the viewport bounds to honor "effects whose world position
 * falls outside the viewport are not rendered", so it takes the same `viewport` prop as
 * `GridRenderer`.
 */
export interface EffectsLayerProps {
  readonly projection: GameplayProjection;
  readonly pack: CompiledContentPack;
  readonly lastEvents: readonly PublicEvent[];
  readonly camera: CameraOrigin;
  readonly viewport: CameraViewport;
}

interface LiveEffect { readonly id: number; readonly effect: TransientEffect }

let nextLiveEffectId = 0;

const EFFECT_LIFETIME_MS: Record<TransientEffect['kind'], number> = {
  'hit-flash': 200,
  'attack-streak': 240,
  'death-burst': 320,
};

/**
 * Purely decorative overlay: `aria-hidden`, `pointer-events: none`, animates only
 * transform/opacity/filter, and never influences gameplay truth (that lives in `GridRenderer`).
 * Live transient effects are stored in world coordinates and re-projected to screen space from the
 * CURRENT camera on every render, so a mid-animation scroll moves them with the world instead of
 * stranding them at a stale viewport position.
 */
export function EffectsLayer({ projection, pack, lastEvents, camera, viewport }: EffectsLayerProps): JSX.Element {
  const hero = heroOf(projection);
  const heroId = hero.actorId;

  const positionsRef = useRef(new Map<OpaqueId, Readonly<{ x: number; y: number }>>());
  const floorIdRef = useRef(projection.floor.floorId);
  const lastEventsRef = useRef<readonly PublicEvent[] | null>(null);
  const [liveEffects, setLiveEffects] = useState<readonly LiveEffect[]>([]);

  // Record last-known world positions for the hero and every currently visible actor. This keeps
  // history for actors that die this very turn: by the time `projection` reflects their death
  // they are already gone from `projection.actors`, so their position must come from what we
  // recorded while they were still alive (an earlier render, or this one for survivors).
  positionsRef.current.set(heroId, { x: hero.x, y: hero.y });
  for (const actor of actorsOf(projection)) {
    positionsRef.current.set(actor.actorId, { x: actor.x, y: actor.y });
  }

  const removeEffect = (id: number): void => {
    setLiveEffects((current) => current.filter((entry) => entry.id !== id));
  };

  useEffect(() => {
    if (floorIdRef.current !== projection.floor.floorId) {
      floorIdRef.current = projection.floor.floorId;
      lastEventsRef.current = lastEvents;
      setLiveEffects([]);
      return;
    }
    if (lastEventsRef.current === lastEvents) return;
    lastEventsRef.current = lastEvents;
    const mapped = effectsForEvents(lastEvents, heroId, positionsRef.current);
    if (mapped.length === 0) return;
    const additions = mapped.map((effect) => ({ id: (nextLiveEffectId += 1), effect }));
    setLiveEffects((current) => {
      const merged = [...current, ...additions];
      return merged.length > MAX_TRANSIENT_EFFECTS ? merged.slice(-MAX_TRANSIENT_EFFECTS) : merged;
    });
    // A reduced-motion `animation: none` never fires `animationend`, so a lifetime timeout backs
    // it up to guarantee cleanup regardless of motion preference.
    for (const addition of additions) {
      setTimeout(() => removeEffect(addition.id), EFFECT_LIFETIME_MS[addition.effect.kind]);
    }
  }, [lastEvents, projection.floor.floorId, heroId]);

  const withinViewport = (x: number, y: number): boolean =>
    x >= camera.x && x < camera.x + viewport.width && y >= camera.y && y < camera.y + viewport.height;

  const light = equippedLightSource(projection, pack);

  /*
   * Hero condition aura (Task 7): `projection.hero.conditions` is the ONLY conditions field the
   * client receives -- actor (non-hero) conditions are NOT projected at all (confirmed against
   * `packages/engine/src/projection.ts`), so this aura can only ever represent the HERO's own
   * active conditions, never an NPC's; that is a disclosed limitation, not an oversight.
   * Unlike hit-flash/attack-streak/death-burst, this is NOT a `TransientEffect` with its own
   * timer-based cleanup: it is derived fresh from `projection.hero.conditions` on every render, so
   * it appears the instant a condition is applied and disappears the instant the condition list
   * empties (expiry, cure, etc.) with no separate removal logic to keep in sync.
   */
  const primaryCondition = pickPrimaryCondition(hero.conditions ?? []);

  return (
    <div aria-hidden="true" className="effects-layer">
      {primaryCondition && withinViewport(hero.x, hero.y) && (
        <div
          className="condition-aura"
          data-condition={primaryCondition.conditionId}
          style={{
            '--x': hero.x - camera.x,
            '--y': hero.y - camera.y,
            '--aura-color': primaryCondition.color,
          } as CSSProperties}
        />
      )}
      {light && withinViewport(hero.x, hero.y) && (
        <div
          className="glow"
          data-source={light.contentId}
          style={{
            '--x': hero.x - camera.x,
            '--y': hero.y - camera.y,
            '--glow-color': `rgb(${light.color[0]}, ${light.color[1]}, ${light.color[2]})`,
            '--glow-radius': light.radius,
            '--glow-intensity': light.fuelFraction,
          } as CSSProperties}
        />
      )}
      {liveEffects.map(({ id, effect }) => {
        if (!withinViewport(effect.x, effect.y)) return null;
        const style: CSSProperties = {
          '--x': effect.x - camera.x,
          '--y': effect.y - camera.y,
          ...(effect.toX !== undefined && effect.toY !== undefined ? {
            '--to-x': effect.toX - camera.x,
            '--to-y': effect.toY - camera.y,
          } : {}),
        } as CSSProperties;
        return (
          <div
            key={id}
            className={`effect effect-${effect.kind}`}
            style={style}
            onAnimationEnd={() => removeEffect(id)}
          />
        );
      })}
    </div>
  );
}
