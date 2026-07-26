import type { BalanceContentEntry, CompiledContentPack } from '@woven-deep/content';

/**
 * `balanceEntry`/`actionCostFor` split out of `actions.ts` so `stats.ts`, `swarm-behavior.ts`,
 * `merchant-behavior.ts`, and `trade.ts` can call them without importing `actions.ts` itself --
 * `actions.ts` imports `action-dispatch.ts`'s `isDispatchableActionType`, and `action-dispatch.ts`
 * imports each of those four modules for its own resolvers, so that back-edge used to make the
 * whole group a runtime circular dependency cluster. `actions.ts` re-exports both functions so its
 * own existing exports are unchanged.
 */
export function balanceEntry(content: CompiledContentPack): BalanceContentEntry {
  const entries = content.entries.filter(
    (entry): entry is BalanceContentEntry => entry.kind === 'balance',
  );
  if (entries.length !== 1)
    throw new Error(`internal invariant: expected one balance entry; found ${entries.length}`);
  return entries[0]!;
}

export function actionCostFor(entry: BalanceContentEntry, actionId: string): number {
  const cost = entry.actionCosts[actionId] ?? entry.normalActionCost;
  if (!Number.isSafeInteger(cost) || cost < 0)
    throw new Error(`internal invariant: invalid action cost ${actionId}`);
  return cost;
}
