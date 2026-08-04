export type HungerStage = 'sated' | 'hungry' | 'weak' | 'starving';

export interface SurvivalState {
  readonly hungerReserve: number;
  readonly hungerStage: HungerStage;
  readonly nextStarvationAt: number | null;
  /**
   * Starvation ticks suffered since the hero last stopped starving. Drives the escalating tick
   * damage in `advanceSurvival`; eating resets it to zero alongside `nextStarvationAt`.
   */
  readonly starvationTicks: number;
  readonly emittedHungerWarnings: readonly HungerStage[];
  readonly emittedFuelWarnings: readonly string[];
}
