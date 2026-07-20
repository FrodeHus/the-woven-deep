import type { BaseContentEntry, CompletionType, DerivedStatName } from './common.js';

export interface PointBuyDefinition {
  readonly budget: number;
  readonly costs: readonly { readonly value: number; readonly cost: number }[];
}

export interface ScoreCoefficientsDefinition {
  readonly depthCoefficient: number;
  readonly bossDefeatCoefficient: number;
  readonly threatCoefficient: number;
  readonly discoveryCoefficient: number;
  readonly completionBonus: Readonly<Record<CompletionType, number>>;
  readonly turnEfficiencyBudget: number;
  readonly turnEfficiencyDecayInterval: number;
}

export interface BalanceContentEntry extends BaseContentEntry {
  readonly kind: 'balance';
  readonly startingCurrency: number;
  readonly readinessThreshold: number;
  readonly normalActionCost: number;
  readonly speedMinimum: number;
  readonly speedMaximum: number;
  readonly energyMinimum: number;
  readonly energyMaximum: number;
  readonly attributeMinimum: number;
  readonly attributeMaximum: number;
  readonly hungerMaximum: number;
  readonly hungerThresholds: Readonly<{ hungry: number; weak: number; starving: number }>;
  readonly starvationInterval: number;
  readonly starvationDamage: number;
  readonly recoveryInterval: number;
  readonly recoveryAmount: number;
  readonly restMaximumDuration: number;
  readonly recoveryByHungerStage: Readonly<
    Record<'sated' | 'hungry' | 'weak' | 'starving', number>
  >;
  readonly hungerStageModifiers: Readonly<
    Record<
      'sated' | 'hungry' | 'weak' | 'starving',
      Readonly<Partial<Record<DerivedStatName, number>>>
    >
  >;
  readonly formulas: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly actionCosts: Readonly<Record<string, number>>;
  readonly score: ScoreCoefficientsDefinition;
  readonly pointBuy: PointBuyDefinition;
  readonly restockMilestones: readonly number[];
  readonly house: Readonly<{ baseCapacity: number; strongboxIncrement: number }>;
  readonly encounterDensity: Readonly<{ cellsPerEncounter: number }>;
}
