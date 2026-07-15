export interface RunKillsByModel {
  readonly individual: number;
  readonly group: number;
  readonly swarm: number;
  readonly boss: number;
}

export interface RunMetrics {
  readonly kills: number;
  readonly killsByModel: RunKillsByModel;
  readonly bossKills: number;
  readonly championKills: number;
  readonly echoKills: number;
  readonly threatDefeated: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly itemsCollected: number;
  readonly itemsIdentified: number;
  readonly currencyEarned: number;
  readonly currencySpent: number;
  readonly tradesCompleted: number;
  readonly floorsEntered: number;
  readonly deepestDepth: number;
  readonly discoveriesRevealed: number;
  readonly turnsElapsed: number;
  readonly restsCompleted: number;
}

export function emptyRunMetrics(): RunMetrics {
  return {
    kills: 0, killsByModel: { individual: 0, group: 0, swarm: 0, boss: 0 },
    bossKills: 0, championKills: 0, echoKills: 0, threatDefeated: 0,
    damageDealt: 0, damageTaken: 0, itemsCollected: 0, itemsIdentified: 0,
    currencyEarned: 0, currencySpent: 0, tradesCompleted: 0,
    floorsEntered: 0, deepestDepth: 0, discoveriesRevealed: 0,
    turnsElapsed: 0, restsCompleted: 0,
  };
}
