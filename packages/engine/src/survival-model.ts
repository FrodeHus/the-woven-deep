export type HungerStage = 'sated' | 'hungry' | 'weak' | 'starving';

export interface SurvivalState {
  readonly hungerReserve: number;
  readonly hungerStage: HungerStage;
  readonly nextStarvationAt: number | null;
  readonly emittedHungerWarnings: readonly HungerStage[];
  readonly emittedFuelWarnings: readonly string[];
}
