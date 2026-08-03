import type { BalanceContentEntry, MonsterContentEntry } from '../../model.js';
import type { ContentCompileIssue } from '../error.js';
import { ACTION_COST_IDS } from '../registries.js';
import { compareCodeUnits, issue, type LocatedContentEntry } from './shared.js';

function balanceIssues(
  located: LocatedContentEntry & { entry: BalanceContentEntry },
  monsters: readonly (LocatedContentEntry & { entry: MonsterContentEntry })[],
): ContentCompileIssue[] {
  const { entry: balance, file } = located;
  const path = `$.entries.${balance.id}`;
  const issues: ContentCompileIssue[] = [];
  if (balance.speedMinimum > balance.speedMaximum) {
    issues.push(issue(file, `${path}.speedMinimum`, 'speedMinimum must not exceed speedMaximum'));
  }
  if (balance.energyMinimum > balance.energyMaximum) {
    issues.push(
      issue(file, `${path}.energyMinimum`, 'energyMinimum must not exceed energyMaximum'),
    );
  }
  if (balance.attributeMinimum > balance.attributeMaximum) {
    issues.push(
      issue(file, `${path}.attributeMinimum`, 'attributeMinimum must not exceed attributeMaximum'),
    );
  }
  if (
    balance.readinessThreshold < balance.energyMinimum ||
    balance.readinessThreshold > balance.energyMaximum
  ) {
    issues.push(
      issue(
        file,
        `${path}.readinessThreshold`,
        'readinessThreshold must be within the energy bounds',
      ),
    );
  }
  const registeredCosts = new Set<string>(ACTION_COST_IDS);
  for (const actionId of Object.keys(balance.actionCosts).sort(compareCodeUnits)) {
    if (!registeredCosts.has(actionId)) {
      issues.push(
        issue(file, `${path}.actionCosts.${actionId}`, `unregistered action cost ${actionId}`),
      );
    }
  }
  for (const monster of monsters) {
    if (monster.entry.speed < balance.speedMinimum || monster.entry.speed > balance.speedMaximum) {
      issues.push(
        issue(
          monster.file,
          `$.entries.${monster.entry.id}.speed`,
          `speed ${monster.entry.speed} is outside balance bounds ${balance.speedMinimum} through ${balance.speedMaximum}`,
        ),
      );
    }
    for (const [name, value] of Object.entries(monster.entry.attributes).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    )) {
      if (value < balance.attributeMinimum || value > balance.attributeMaximum) {
        issues.push(
          issue(
            monster.file,
            `$.entries.${monster.entry.id}.attributes.${name}`,
            `attribute ${value} is outside balance bounds ${balance.attributeMinimum} through ${balance.attributeMaximum}`,
          ),
        );
      }
    }
  }
  return issues;
}

export function balanceEntriesIssues(
  locatedEntries: readonly LocatedContentEntry[],
): ContentCompileIssue[] {
  const issues: ContentCompileIssue[] = [];
  const balanceEntries = locatedEntries.filter(({ entry }) => entry.kind === 'balance');
  if (balanceEntries.length > 1) {
    issues.push(
      issue(
        balanceEntries[1]!.file,
        '$.entries',
        `expected exactly one balance entry; found ${balanceEntries.length}`,
      ),
    );
  }
  if (balanceEntries.length === 1) {
    const located = balanceEntries[0] as LocatedContentEntry & { entry: BalanceContentEntry };
    const monsters = locatedEntries.filter(
      (candidate): candidate is LocatedContentEntry & { entry: MonsterContentEntry } =>
        candidate.entry.kind === 'monster',
    );
    issues.push(...balanceIssues(located, monsters));
    // A nonzero curse chance with an empty curse roster compiles clean but throws at generation
    // time, on the first floor that actually rolls a curse -- mid-run instead of at
    // content:validate. Zero chance with no curses stays legal (curses disabled).
    const { chanceBps } = located.entry.curses;
    const anyChance = chanceBps.shallow > 0 || chanceBps.mid > 0 || chanceBps.deep > 0;
    if (anyChance && !locatedEntries.some(({ entry }) => entry.kind === 'curse')) {
      issues.push(
        issue(
          located.file,
          `$.entries.${located.entry.id}.curses.chanceBps`,
          'nonzero curse chance requires at least one curse entry in the pack',
        ),
      );
    }
  }
  return issues;
}
