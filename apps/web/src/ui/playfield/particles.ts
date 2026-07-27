import type { TransientEffect } from '../effects-map.js';
import { TILE_HALF_H, TILE_HALF_W } from './iso-math.js';

/**
 * One combat-effect particle, in the renderer's iso-local pixel space (the same space
 * `IsoRenderer.isoLocal` produces): `x`/`y` are the local screen-plane position, `z` is a height
 * above the floor that the renderer subtracts from `y` when drawing, so a rising/falling particle
 * reads as vertical motion rather than sliding across the floor.
 */
export interface Particle {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly bornAt: number;
  readonly ttlMs: number;
  readonly color: number;
  readonly size: number;
  readonly additive: boolean;
}

const HIT_FLASH_COUNT = 6;
const HIT_FLASH_TTL_MS = 320;
const HIT_FLASH_COLOR = 0xff5544;
const HIT_FLASH_SIZE = 3;
const HIT_FLASH_SPEED = 0.06;

const DEATH_BURST_COUNT = 18;
const DEATH_BURST_TTL_MS = 700;
const DEATH_BURST_COLOR = 0x9a6bff;
const DEATH_BURST_SIZE = 4;
const DEATH_BURST_SPEED = 0.1;

const ATTACK_STREAK_COUNT = 5;
const ATTACK_STREAK_TTL_MS = 220;
const ATTACK_STREAK_COLOR = 0xffe9a8;
const ATTACK_STREAK_SIZE = 2.5;
const ATTACK_STREAK_JITTER = 0.02;

/** Fixed per-step integration timestep (`stepParticles` has no `dt` parameter, only `now`, so it
 * cannot recover the real frame delta from its inputs alone -- these are cosmetic combat
 * flourishes, not physics, so a nominal ~60fps step keeps the function pure and simple rather than
 * threading a hidden "last update" timestamp through the public `Particle` shape.) */
const STEP_MS = 1000 / 60;
const GRAVITY_PX_PER_MS2 = 0.0016;

/** Iso-local pixel position of a world grid cell, matching `IsoRenderer.isoLocal` exactly so
 * particles line up with the actors/features they surround. */
function isoLocal(x: number, y: number): readonly [number, number] {
  return [(x - y) * TILE_HALF_W, (x + y) * TILE_HALF_H];
}

function burst(
  originX: number,
  originY: number,
  now: number,
  count: number,
  speed: number,
  ttlMs: number,
  color: number,
  size: number,
  additive: boolean,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const magnitude = speed * (0.5 + Math.random() * 0.5);
    particles.push({
      x: originX,
      y: originY,
      z: 0,
      vx: Math.cos(angle) * magnitude,
      vy: Math.sin(angle) * magnitude * 0.5,
      vz: 0.12 + Math.random() * 0.1,
      bornAt: now,
      ttlMs: ttlMs * (0.8 + Math.random() * 0.4),
      color,
      size: size * (0.7 + Math.random() * 0.6),
      additive,
    });
  }
  return particles;
}

function streak(effect: TransientEffect, now: number): Particle[] {
  const [fromX, fromY] = isoLocal(effect.x, effect.y);
  const toX = effect.toX ?? effect.x;
  const toY = effect.toY ?? effect.y;
  const [targetX, targetY] = isoLocal(toX, toY);
  const dx = targetX - fromX;
  const dy = targetY - fromY;

  const particles: Particle[] = [];
  for (let i = 0; i < ATTACK_STREAK_COUNT; i += 1) {
    const t = i / Math.max(1, ATTACK_STREAK_COUNT - 1);
    const jitterX = (Math.random() * 2 - 1) * ATTACK_STREAK_JITTER;
    const jitterY = (Math.random() * 2 - 1) * ATTACK_STREAK_JITTER;
    particles.push({
      x: fromX + dx * t,
      y: fromY + dy * t,
      z: 0,
      vx: dx * 0.002 + jitterX,
      vy: dy * 0.002 + jitterY,
      vz: 0.02,
      bornAt: now,
      ttlMs: ATTACK_STREAK_TTL_MS * (0.8 + Math.random() * 0.4),
      color: ATTACK_STREAK_COLOR,
      size: ATTACK_STREAK_SIZE,
      additive: true,
    });
  }
  return particles;
}

/**
 * Spawns the particle burst for one `TransientEffect`. The only randomness in this module lives
 * here (spawn velocities/ttl/size jitter) -- `stepParticles` is a pure integrator over whatever
 * `spawnForEffect` handed it.
 */
export function spawnForEffect(effect: TransientEffect, now: number): readonly Particle[] {
  const [originX, originY] = isoLocal(effect.x, effect.y);
  switch (effect.kind) {
    case 'hit-flash':
      return burst(
        originX,
        originY,
        now,
        HIT_FLASH_COUNT,
        HIT_FLASH_SPEED,
        HIT_FLASH_TTL_MS,
        HIT_FLASH_COLOR,
        HIT_FLASH_SIZE,
        false,
      );
    case 'death-burst':
      return burst(
        originX,
        originY,
        now,
        DEATH_BURST_COUNT,
        DEATH_BURST_SPEED,
        DEATH_BURST_TTL_MS,
        DEATH_BURST_COLOR,
        DEATH_BURST_SIZE,
        true,
      );
    case 'attack-streak':
      return streak(effect, now);
    default:
      return [];
  }
}

/**
 * Integrates every particle by one fixed step and drops any whose ttl has elapsed by `now`. Pure:
 * given the same particle array and `now`, always returns an equal (by value) result.
 */
export function stepParticles(particles: readonly Particle[], now: number): readonly Particle[] {
  const next: Particle[] = [];
  for (const particle of particles) {
    if (now - particle.bornAt >= particle.ttlMs) continue;
    const vz = particle.vz - GRAVITY_PX_PER_MS2 * STEP_MS;
    next.push({
      ...particle,
      x: particle.x + particle.vx * STEP_MS,
      y: particle.y + particle.vy * STEP_MS,
      z: Math.max(0, particle.z + vz * STEP_MS),
      vz,
    });
  }
  return next;
}

export interface EffectSpawnDecision {
  readonly newEffects: readonly TransientEffect[];
  readonly seenKeys: ReadonlySet<string>;
}

/**
 * Decides which of `effects` are new since the last call, salting every dedup key with a
 * caller-owned `generation` counter: `${generation}:${effect.key}`.
 *
 * This exists because `effectsForEvents`'s `hero.damaged` branch keys its effect by
 * `${event.type}-${index}` (an array position within one snapshot's `lastEvents`), not a stable
 * event id -- by design, since the hero-damaged event carries no attacker identity to derive one
 * from. Across two DIFFERENT snapshots (i.e. two different turns), that literal key can recur
 * (e.g. `hero.damaged-0` every time a hit happens to land first in that turn's event list), so a
 * dedup set keyed on the raw effect key alone would treat the second hit as already-seen and
 * silently drop it forever. Salting by generation fixes that without touching `effects-map.ts` or
 * the engine: two literally-identical effect keys from two different generations produce two
 * different salted keys, so both spawn; the SAME snapshot object re-fed to the renderer (a resize
 * or a targeting-only re-render, which calls `setSnapshot` again without a new snapshot) keeps the
 * same generation, so its effects are still deduped exactly once, matching the pre-fix behavior
 * for genuine re-feeds.
 *
 * Bounded correctly, not just by LRU size: any previously-seen key from a generation older than
 * `generation - 1` is pruned unconditionally on every call (a fight can only ever be "this turn" or
 * "last turn" from the caller's perspective, since the caller bumps `generation` once per new
 * snapshot), and `maxSeenKeys` remains as a secondary cap purely to bound spawn volume within a
 * single generation, matching `MAX_TRANSIENT_EFFECTS`.
 *
 * Pure: returns a new `seenKeys` set derived from the input one; never mutates its input.
 */
export function selectNewEffects(
  effects: readonly TransientEffect[],
  generation: number,
  seenKeys: ReadonlySet<string>,
  maxSeenKeys: number,
): EffectSpawnDecision {
  const next = new Set<string>();
  for (const key of seenKeys) {
    const separator = key.indexOf(':');
    const keyGeneration = separator === -1 ? Number.NaN : Number(key.slice(0, separator));
    if (Number.isFinite(keyGeneration) && keyGeneration >= generation - 1) {
      next.add(key);
    }
  }

  const newEffects: TransientEffect[] = [];
  for (const effect of effects) {
    const salted = `${generation}:${effect.key}`;
    if (next.has(salted)) continue;
    next.add(salted);
    newEffects.push(effect);
    while (next.size > maxSeenKeys) {
      const oldest = next.values().next().value;
      if (oldest === undefined) break;
      next.delete(oldest);
    }
  }

  return { newEffects, seenKeys: next };
}
