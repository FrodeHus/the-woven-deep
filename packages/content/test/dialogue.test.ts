import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileContentDirectory, ContentCompileError } from '../src/compiler/index.js';

const compactVault =
  '{kind: vault, id: vault.test-room, name: Test room, tags: [test], minDepth: 1, maxDepth: 5, rarity: common, weight: 10, maxPerFloor: 1, margin: 1, transforms: {rotations: [0, 180], reflectHorizontal: true}, layout: ["#####", "#+m.#", "#####"], legend: {"#": {terrain: wall}, ".": {terrain: floor}, "+": {terrain: floor, entrance: true}, m: {terrain: floor, slot: {id: monster-main, kind: monster, required: true, tags: [guard]}}}}';
const compactMonster =
  '{kind: monster, id: monster.rat, name: Rat, glyph: r, color: "#aaaaaa", lore: "A common cave rat.", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 5, attributes: {might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2}, health: 4, speed: 110, accuracy: 1, defense: 10, perception: 6, damage: {count: 1, sides: 3, bonus: 0}, armor: 0, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: hostile, behaviorId: behavior.approach-and-attack, behaviorParameters: {}, threat: 2, rarity: common}';
const compactItem =
  '{kind: item, id: item.lantern, name: Lantern, glyph: "¤", color: "#eeeeaa", tags: [defense, food, healing, identification, light, offense], minDepth: 1, maxDepth: 20, category: light, stackLimit: 1, price: 4, rarity: common, actionCost: 100, equipment: {slots: [off-hand], handedness: one-handed, reservedSlots: []}, combat: null, light: {color: [255, 200, 100], radius: 6, strength: 180, fuelCapacity: 1000, fuelPerTime: 1, warningThresholds: [100], fuelTags: [lamp-oil]}, identification: {mode: known, poolId: null}, effects: []}';
const compactFaction =
  '{kind: npc-faction, id: npc-faction.lampwrights, name: Lampwrights, tags: [], minimumReputation: -100, maximumReputation: 100, startingReputation: 0, tiers: [{tierId: wary, name: Wary, minimum: -100, maximum: -1, purchasePriceBps: 12000, salePriceBps: 8000, acceptsTrade: true, serviceIds: []}, {tierId: neutral, name: Neutral, minimum: 0, maximum: 100, purchasePriceBps: 10000, salePriceBps: 10000, acceptsTrade: true, serviceIds: [merchant-service.identify]}]}';
const compactNpc =
  '{kind: npc, id: npc.lampwright, name: Lampwright, tags: [], glyph: L, color: "#ffd166", factionId: npc-faction.lampwrights, dialogueId: dialogue.lampwright, attributes: {might: 8, agility: 9, vitality: 10, wits: 12, resolve: 11}, health: 20, speed: 100, perception: 12, accuracy: 8, defense: 10, damage: {count: 1, sides: 4, bonus: 0}, armor: 1, resistances: {physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0}, disposition: neutral, behaviorId: npc-behavior.travelling-merchant, behaviorParameters: {}, selfPreservationThresholdBps: 3500}';

const compactDialogue =
  '{kind: dialogue, id: dialogue.lampwright, name: Lampwright dialogue, tags: [], greeting: "Care for some oil?", topics: [{id: greeting, prompt: "Hello", response: "Welcome, traveller.", reveals: [trade], once: false}, {id: trade, prompt: "What do you sell?", response: "Lamps and oil.", consequence: {kind: open-trade}}, {id: rumor, prompt: "Any news?", response: "The wardens grow restless.", consequence: {kind: reputation, factionId: npc-faction.lampwrights, amount: 5}}, {id: lore, prompt: "Tell me about the rats.", response: "They gnaw at everything.", consequence: {kind: reveal-lore, contentId: monster.rat}}]}';

function contentFile(...entries: readonly string[]): string {
  return `schemaVersion: 8\nentries: [${entries.join(', ')}]\n`;
}

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'woven-content-dialogue-'));
  const compactBalance =
    '{kind: balance, startingCurrency: 40, id: balance.core, name: Core, tags: [core], readinessThreshold: 100, normalActionCost: 100, speedMinimum: 25, speedMaximum: 400, energyMinimum: -10000, energyMaximum: 10000, attributeMinimum: 0, attributeMaximum: 30, hungerMaximum: 10000, hungerThresholds: {hungry: 3000, weak: 1000, starving: 0}, starvationInterval: 500, starvationDamage: 1, recoveryInterval: 500, recoveryAmount: 1, weaveRegenAmount: 2, restMaximumDuration: 5000, recoveryByHungerStage: {sated: 100, hungry: 50, weak: 0, starving: 0}, hungerStageModifiers: {sated: {}, hungry: {}, weak: {}, starving: {}}, formulas: {health: {base: 8, vitality: 2}}, actionCosts: {action.move: 100}, score: {depthCoefficient: 100, bossDefeatCoefficient: 250, threatCoefficient: 5, discoveryCoefficient: 25, completionBonus: {died: 0, refused: 400, became-heart: 800, broke-cycle: 1500}, turnEfficiencyBudget: 500, turnEfficiencyDecayInterval: 200}, pointBuy: {budget: 1, costs: [{value: 0, cost: 0}, {value: 1, cost: 0}, {value: 2, cost: 0}, {value: 3, cost: 0}, {value: 4, cost: 0}, {value: 5, cost: 0}, {value: 6, cost: 0}, {value: 7, cost: 0}, {value: 8, cost: 0}, {value: 9, cost: 0}, {value: 10, cost: 0}, {value: 11, cost: 0}, {value: 12, cost: 0}, {value: 13, cost: 0}, {value: 14, cost: 0}, {value: 15, cost: 0}, {value: 16, cost: 0}, {value: 17, cost: 0}, {value: 18, cost: 0}, {value: 19, cost: 0}, {value: 20, cost: 0}, {value: 21, cost: 0}, {value: 22, cost: 0}, {value: 23, cost: 0}, {value: 24, cost: 0}, {value: 25, cost: 0}, {value: 26, cost: 0}, {value: 27, cost: 0}, {value: 28, cost: 0}, {value: 29, cost: 0}, {value: 30, cost: 0}]}, restockMilestones: [5, 10, 15, 20], house: {baseCapacity: 6, strongboxIncrement: 4}, encounterDensity: {cellsPerEncounter: 2000}, fragmentSpawnRollDenominator: 40}';
  const completeFiles = { 'balance.yaml': contentFile(compactBalance), ...files };
  for (const [path, source] of Object.entries(completeFiles)) {
    const target = join(root, path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, source);
  }
  return root;
}

describe('dialogue content kind', () => {
  it('compiles a dialogue entry linked to an npc via dialogueId', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactItem,
        compactVault,
        compactFaction,
        compactNpc,
        compactDialogue,
      ),
    });
    const pack = await compileContentDirectory({ rootDir: root });
    const npc = pack.entries.find((entry) => entry.id === 'npc.lampwright');
    expect(npc).toMatchObject({ dialogueId: 'dialogue.lampwright' });
    const dialogue = pack.entries.find((entry) => entry.id === 'dialogue.lampwright');
    expect(dialogue).toMatchObject({ kind: 'dialogue', greeting: 'Care for some oil?' });
  });

  it('rejects an npc dialogueId that does not resolve to a dialogue entry', async () => {
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactItem,
        compactVault,
        compactFaction,
        compactNpc.replace('dialogueId: dialogue.lampwright', 'dialogueId: dialogue.missing'),
        compactDialogue,
      ),
    });
    let caught: unknown;
    try {
      await compileContentDirectory({ rootDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentCompileError);
    expect((caught as ContentCompileError).issues).toContainEqual(
      expect.objectContaining({
        path: '$.entries.npc.lampwright.dialogueId',
        message: 'unknown dialogue reference dialogue.missing',
      }),
    );
  });

  it('rejects a reveals target that does not name another topic', async () => {
    const badDialogue = compactDialogue.replace('reveals: [trade]', 'reveals: [nonexistent]');
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactItem,
        compactVault,
        compactFaction,
        compactNpc,
        badDialogue,
      ),
    });
    let caught: unknown;
    try {
      await compileContentDirectory({ rootDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentCompileError);
    expect((caught as ContentCompileError).issues).toContainEqual(
      expect.objectContaining({
        path: '$.entries.dialogue.lampwright.topics.greeting.reveals',
        message: 'unknown topic nonexistent',
      }),
    );
  });

  it('rejects a reputation consequence with an unknown faction', async () => {
    const badDialogue = compactDialogue.replace(
      'factionId: npc-faction.lampwrights',
      'factionId: npc-faction.missing',
    );
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactItem,
        compactVault,
        compactFaction,
        compactNpc,
        badDialogue,
      ),
    });
    let caught: unknown;
    try {
      await compileContentDirectory({ rootDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentCompileError);
    expect((caught as ContentCompileError).issues).toContainEqual(
      expect.objectContaining({
        path: '$.entries.dialogue.lampwright.topics.rumor.consequence.factionId',
        message: 'unknown npc-faction reference npc-faction.missing',
      }),
    );
  });

  it('rejects a reveal-lore consequence pointing at a non-lore entry', async () => {
    const badDialogue = compactDialogue.replace(
      'contentId: monster.rat',
      'contentId: item.lantern',
    );
    const root = await fixture({
      'content.yaml': contentFile(
        compactMonster,
        compactItem,
        compactVault,
        compactFaction,
        compactNpc,
        badDialogue,
      ),
    });
    let caught: unknown;
    try {
      await compileContentDirectory({ rootDir: root });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContentCompileError);
    expect((caught as ContentCompileError).issues).toContainEqual(
      expect.objectContaining({
        path: '$.entries.dialogue.lampwright.topics.lore.consequence.contentId',
        message: 'reveal-lore item.lantern must be a monster or item with authored lore',
      }),
    );
  });
});
