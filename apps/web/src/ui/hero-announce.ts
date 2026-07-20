/**
 * Significant-transition detection for the hero-state screen-reader announcer.
 *
 * The play screen already exposes the hero's vitals as visible text (`HeroPanel`/`VitalsStrip`) and
 * the log as a polite live region, but nothing announced a *change* in the hero's own condition:
 * a blind player crossing into critical health, tipping into a worse hunger stage, or gaining a
 * status affliction got no spoken cue. Feeding EVERY projection tick into a live region would spam
 * the screen reader on every step (turn count, camera, ambient actor moves), so this module reduces
 * a projection change to only the announcements a player actually needs to hear -- and returns an
 * empty list for the common case where nothing crossed a threshold.
 *
 * Pure and side-effect-free so the threshold logic is unit-testable without a DOM; `HeroStatusAnnouncer`
 * (panels.tsx) is the thin React shell that holds the previous snapshot in a ref and pushes the
 * joined result into an `aria-live="polite"` region.
 */

/** Coarse health band: only a crossing BETWEEN bands is worth announcing, never a drop within one. */
export type HealthBand = 'ok' | 'low' | 'critical';

/** Health <=25% is critical, <=50% is low, else ok. `maxHealth<=0` degrades to `ok` (no div-by-zero,
 * and a hero with no max health has no meaningful band to announce). */
export function healthBand(health: number, maxHealth: number): HealthBand {
  if (maxHealth <= 0) return 'ok';
  const ratio = health / maxHealth;
  if (ratio <= 0.25) return 'critical';
  if (ratio <= 0.5) return 'low';
  return 'ok';
}

const BAND_SEVERITY: Record<HealthBand, number> = { ok: 0, low: 1, critical: 2 };

export interface HeroAnnounceCondition {
  readonly conditionId: string;
  readonly name: string;
}

/** The minimal projected-hero shape this module compares between ticks. */
export interface HeroAnnounceSnapshot {
  readonly health: number;
  readonly maxHealth: number;
  readonly hungerStage: string;
  readonly conditions: readonly HeroAnnounceCondition[];
}

/**
 * The announcements a screen reader should hear when the hero goes from `prev` to `next`. Empty when
 * nothing crossed a threshold -- the caller must NOT push an empty result into the live region.
 *
 * Rules:
 *  - Health: announce only when the coarse band changes. Worsening names the new band ("Health low."
 *    / "Health critical."); improving is a single "Health recovering." A drop that stays within one
 *    band (e.g. 90% -> 60%) announces nothing.
 *  - Hunger: announce the new stage whenever the stage string changes.
 *  - Conditions: announce each newly-gained condition ("Afflicted: X.") and each condition that
 *    dropped off the list since last tick ("X has faded."), keyed by conditionId so a stack/duration
 *    change on an already-present condition is silent.
 */
export function heroAnnouncements(
  prev: HeroAnnounceSnapshot,
  next: HeroAnnounceSnapshot,
): string[] {
  const messages: string[] = [];

  const prevBand = healthBand(prev.health, prev.maxHealth);
  const nextBand = healthBand(next.health, next.maxHealth);
  if (BAND_SEVERITY[nextBand] > BAND_SEVERITY[prevBand]) {
    messages.push(nextBand === 'critical' ? 'Health critical.' : 'Health low.');
  } else if (BAND_SEVERITY[nextBand] < BAND_SEVERITY[prevBand]) {
    messages.push('Health recovering.');
  }

  if (next.hungerStage !== prev.hungerStage) {
    messages.push(`Hunger: ${next.hungerStage}.`);
  }

  const prevIds = new Set(prev.conditions.map((condition) => condition.conditionId));
  const nextIds = new Set(next.conditions.map((condition) => condition.conditionId));
  for (const condition of next.conditions) {
    if (!prevIds.has(condition.conditionId)) messages.push(`Afflicted: ${condition.name}.`);
  }
  for (const condition of prev.conditions) {
    if (!nextIds.has(condition.conditionId)) messages.push(`${condition.name} has faded.`);
  }

  return messages;
}

/** The minimal projected-floor shape this module compares between ticks. */
export interface FloorAnnounceSnapshot {
  readonly floorId: string;
  readonly depth: number;
  readonly town: boolean;
}

/**
 * The announcement for a floor transition, or `null` when there is nothing to say -- the caller must
 * NOT push a `null` result into the live region. This is the only spoken cue for a depth change: the
 * engine emits no descend event and the log never narrates it, and demoting `StatusBar` off
 * `role="status"` (to stop its turn counter from spamming every step) removed the last SR-audible
 * path, so this function is that path.
 *
 * Rules (same silent-on-mount discipline as `heroAnnouncements`, keyed on `floorId` instead of health/
 * hunger/conditions):
 *  - `prev === null` (first tick, or a restore that boots straight into an already-descended save) is
 *    always silent -- entering the screen must not announce the floor the player is already on.
 *  - Unless `next.floorId` differs from `prev.floorId`, stays silent -- a projection tick that
 *    doesn't move the hero to a different floor (turn/combat churn) must not repeat the line.
 *  - Entering the town announces "Returned to the town."; entering a dungeon depth announces
 *    "Depth N."
 */
export function floorAnnouncement(
  prev: FloorAnnounceSnapshot | null,
  next: FloorAnnounceSnapshot,
): string | null {
  if (prev === null || prev.floorId === next.floorId) return null;
  return next.town ? 'Returned to the town.' : `Depth ${next.depth}.`;
}
