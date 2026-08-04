import { describe, expect, it } from 'vitest';
import {
  CONTENT_SCHEMA_VERSION,
  type CompiledContentPack,
  type MonsterContentEntry,
} from '@woven-deep/content';
import type { HauntView, PublicEvent } from '@woven-deep/engine';
import { LOG_CAPACITY, foldEventsIntoLog, type LogContext } from '../src/session/event-log.js';

const attributes = { might: 3, agility: 8, vitality: 4, wits: 2, resolve: 2 } as const;
const resistances = { physical: 0, fire: 0, cold: 0, lightning: 0, poison: 0, arcane: 0 } as const;
const dice = { count: 1, sides: 4, bonus: 0 } as const;

const boneGnawer: MonsterContentEntry = {
  kind: 'monster',
  id: 'monster.bone-gnawer',
  name: 'Bone-Gnawer',
  tags: [],
  glyph: 'b',
  color: '#aaaaaa',
  minDepth: 1,
  maxDepth: 5,
  attributes,
  health: 4,
  speed: 110,
  accuracy: 1,
  defense: 10,
  perception: 6,
  damage: dice,
  armor: 0,
  resistances,
  disposition: 'hostile',
  behaviorId: 'behavior.approach-and-attack',
  behaviorParameters: {},
  rarity: 'common',
  threat: 1,
  lootTableId: null,
  dropChance: 1,
  onHitConditions: [],
};

const pack: CompiledContentPack = {
  schemaVersion: CONTENT_SCHEMA_VERSION,
  hash: 'demo',
  entries: [boneGnawer],
  generationReport: { foundationalCategories: [] },
};

function hauntView(overrides: Partial<HauntView> = {}): HauntView {
  return {
    hallRecordId: 'record.a',
    role: 'echo',
    heroName: 'Hero',
    deathDepth: 4,
    killerContentId: null,
    causeDepth: null,
    encountered: false,
    appeased: false,
    actorId: null,
    needCategories: [],
    ...overrides,
  };
}

function hauntSighted(hallRecordId: string, role: HauntView['role'] = 'champion'): PublicEvent {
  return {
    type: 'haunt.sighted',
    eventId: 'e1',
    actorId: 'a1',
    hallRecordId,
    role,
  };
}

function hauntAppeased(hallRecordId: string, role: HauntView['role'] = 'echo'): PublicEvent {
  return {
    type: 'haunt.appeased',
    eventId: 'e1',
    actorId: 'a1',
    hallRecordId,
    role,
    offeredItemId: 'item.offered.0001',
    itemIds: ['item.released.0001'],
  };
}

describe('foldEventsIntoLog', () => {
  it('renders combat, item, light, and survival events as readable lines', () => {
    const events: readonly PublicEvent[] = [
      {
        type: 'actor.damaged',
        eventId: 'event.1',
        actorId: 'monster.hidden',
        sourceActorId: 'hero.demo',
        amount: 3,
        health: 17,
      },
      {
        type: 'item.picked-up',
        eventId: 'event.2',
        actorId: 'hero.demo',
        itemId: 'item.sword',
        quantity: 1,
      },
      { type: 'fuel.warning', eventId: 'event.3', itemId: 'item.torch', threshold: 200, fuel: 200 },
      {
        type: 'hunger.stage-changed',
        eventId: 'event.4',
        actorId: 'hero.demo',
        previousStage: 'sated',
        stage: 'hungry',
        reserve: 3000,
      },
    ];
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log.map((line) => line.tone)).toEqual(['combat', 'info', 'warning', 'warning']);
    expect(folded.log[0]?.text).toMatch(/damage/i);
    expect(folded.nextId).toBe(5);
    expect(folded.log.map((line) => line.id)).toEqual([1, 2, 3, 4]);
  });

  it('covers every listed event type with a non-null rendering', () => {
    const events: readonly PublicEvent[] = [
      {
        type: 'actor.damaged',
        eventId: 'e',
        actorId: 'a',
        sourceActorId: 'b',
        amount: 1,
        health: 5,
      },
      {
        type: 'actor.died',
        eventId: 'e',
        actorId: 'a',
        contentId: 'monster.rat',
        killerActorId: 'hero.demo',
      },
      { type: 'hero.damaged', amount: 4, damageType: 'physical' },
      {
        type: 'combat.observed',
        eventId: 'e',
        outcome: 'hit',
        attackerActorId: 'a',
        targetActorId: 'b',
        attackerName: 'Rat',
        targetName: 'Wayfarer',
      },
      { type: 'item.picked-up', eventId: 'e', actorId: 'a', itemId: 'item.x', quantity: 1 },
      { type: 'item.equipped', eventId: 'e', actorId: 'a', itemId: 'item.x', slot: 'main-hand' },
      { type: 'item.consumed', eventId: 'e', actorId: 'a', itemId: 'item.x', quantity: 1 },
      { type: 'item.light-extinguished', eventId: 'e', itemId: 'item.torch' },
      { type: 'fuel.warning', eventId: 'e', itemId: 'item.torch', threshold: 200, fuel: 200 },
      {
        type: 'hunger.stage-changed',
        eventId: 'e',
        actorId: 'a',
        previousStage: 'sated',
        stage: 'hungry',
        reserve: 3000,
      },
      {
        type: 'rest.completed',
        eventId: 'e',
        stopReason: 'full-health',
        elapsed: 400,
        effectiveHealing: 12,
      },
      { type: 'feature.revealed', eventId: 'e', actorId: 'a', featureId: 'feature.trap' },
      { type: 'door.opened', eventId: 'e', actorId: 'a', featureId: 'feature.door' },
      { type: 'trap.triggered', eventId: 'e', actorId: 'a', featureId: 'feature.trap' },
      { type: 'sound.heard', category: 'combat', direction: 'east', distanceBand: 'near' },
      { type: 'action.invalid', eventId: 'e', commandId: 'command.1', reason: 'blocked.wall' },
      {
        type: 'run.concluded',
        eventId: 'e',
        completionType: 'died',
        cause: { type: 'death' } as never,
      },
    ];
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log).toHaveLength(events.length);
    const [restLine] = folded.log.filter((line) => /stop resting/i.test(line.text));
    expect(restLine?.text).toMatch(/full-health/);
    const [invalidLine] = folded.log.filter((line) => /wall blocks/i.test(line.text));
    expect(invalidLine?.tone).toBe('system');
    const [concludedLine] = folded.log.filter((line) => /run has concluded/i.test(line.text));
    expect(concludedLine?.tone).toBe('system');
  });

  it.each([
    ['blocked.door', 'The door is closed.'],
    ['blocked.door-locked', 'The door is locked — it needs a key or a lockpick.'],
    ['blocked.chest', 'A chest blocks the way.'],
    ['blocked.wall', 'A wall blocks the way.'],
    ['blocked.bounds', 'A wall blocks the way.'],
    ['blocked.pillar', 'A pillar blocks the way.'],
    ['blocked.void', 'A wall blocks the way.'],
    ['blocked.corner', 'You cannot squeeze between those corners.'],
    ['blocked.actor', 'Something is in the way.'],
  ] as const)('explains the movement block %s', (reason, text) => {
    const folded = foldEventsIntoLog(
      [],
      [{ type: 'action.invalid', eventId: 'e', commandId: 'command.1', reason }] as PublicEvent[],
      1,
    );
    expect(folded.log[0]).toMatchObject({ text, tone: 'system' });
  });

  it('renders specific copy for each door-related invalid action reason', () => {
    const events: readonly PublicEvent[] = [
      { type: 'action.invalid', eventId: 'e1', commandId: 'command.1', reason: 'door.locked' },
      {
        type: 'action.invalid',
        eventId: 'e2',
        commandId: 'command.2',
        reason: 'door.not-adjacent',
      },
      { type: 'action.invalid', eventId: 'e3', commandId: 'command.3', reason: 'door.occupied' },
      {
        type: 'action.invalid',
        eventId: 'e4',
        commandId: 'command.4',
        reason: 'door.already-open',
      },
      {
        type: 'action.invalid',
        eventId: 'e5',
        commandId: 'command.5',
        reason: 'door.already-closed',
      },
      { type: 'action.invalid', eventId: 'e6', commandId: 'command.6', reason: 'door.missing' },
    ];
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log.map((line) => line.text)).toEqual([
      'The door is locked.',
      'You are too far from the door.',
      'Something is blocking the doorway.',
      'The door is already open.',
      'The door is already closed.',
      'There is no door there.',
    ]);
    expect(folded.log.every((line) => line.tone === 'system')).toBe(true);
  });

  it('caps the log at LOG_CAPACITY dropping oldest first and keeps ids monotonic', () => {
    const waits: readonly PublicEvent[] = Array.from({ length: 250 }, (_unused, index) => ({
      type: 'action.invalid' as const,
      eventId: `event.${index}`,
      commandId: `command.${index}`,
      reason: 'action.unavailable' as const,
    }));
    const folded = foldEventsIntoLog([], waits, 1);
    expect(folded.log).toHaveLength(LOG_CAPACITY);
    expect(folded.nextId).toBe(251);
    expect(folded.log[0]?.id).toBe(51);
    expect(folded.log[folded.log.length - 1]?.id).toBe(250);
  });

  it('maps unknown event types to nothing rather than throwing', () => {
    const events = [
      { type: 'some.future-event', eventId: 'e' },
    ] as unknown as readonly PublicEvent[];
    expect(() => foldEventsIntoLog([], events, 1)).not.toThrow();
    const folded = foldEventsIntoLog([], events, 1);
    expect(folded.log).toEqual([]);
    expect(folded.nextId).toBe(1);
  });

  it('logs the spoken line on a champion encounter', () => {
    const context: LogContext = {
      haunts: [
        hauntView({
          hallRecordId: 'record.a',
          role: 'champion',
          heroName: 'Kaelen',
          killerContentId: 'monster.bone-gnawer',
          causeDepth: 7,
        }),
      ],
      pack,
    };
    const { log } = foldEventsIntoLog([], [hauntSighted('record.a')], 0, context);
    expect(log[0]).toMatchObject({
      text: "Kaelen, the Deep's Champion — fell to a bone-gnawer at depth 7. The Deep remembers.",
      tone: 'curse',
    });
  });

  it('stays silent when no context is supplied', () => {
    const { log } = foldEventsIntoLog([], [hauntSighted('record.a')], 0);
    expect(log).toEqual([]);
  });

  it('stays silent for a haunt the context does not know', () => {
    const { log } = foldEventsIntoLog([], [hauntSighted('record.missing')], 0, {
      haunts: [],
      pack,
    });
    expect(log).toEqual([]);
  });

  it('logs the farewell line when a haunt is appeased', () => {
    const { log } = foldEventsIntoLog([], [hauntAppeased('record.a')], 0, {
      haunts: [hauntView({ hallRecordId: 'record.a', role: 'echo', heroName: 'Mira' })],
      pack,
    });
    expect(log[0]).toMatchObject({
      text: 'Echo of Mira is at peace. The Deep releases what it held.',
      tone: 'curse',
    });
  });

  it('stays silent for an appeasement the context does not know', () => {
    const { log } = foldEventsIntoLog([], [hauntAppeased('record.missing')], 0, {
      haunts: [],
      pack,
    });
    expect(log).toEqual([]);
  });

  it('logs the offer refusal without drama', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'action.invalid',
          eventId: 'e1',
          commandId: 'command.offer',
          reason: 'offer.refused',
        },
      ],
      0,
    );
    expect(log).toMatchObject([{ text: 'The haunt does not want this.', tone: 'system' }]);
  });

  it('logs the tempering-banked line', () => {
    const { log } = foldEventsIntoLog(
      [],
      [{ type: 'hero.tempering-banked', eventId: 'e1', depth: 3, banked: 1 }],
      0,
    );
    expect(log).toMatchObject([{ text: 'The Deep tempers those who dare it.', tone: 'info' }]);
  });

  it('logs the temper spend', () => {
    const { log } = foldEventsIntoLog(
      [],
      [{ type: 'hero.tempered', eventId: 'e1', attribute: 'vitality', value: 13, remaining: 0 }],
      0,
    );
    expect(log).toMatchObject([{ text: 'Vitality hardens to 13.', tone: 'info' }]);
  });

  it('logs the two temper refusals', () => {
    const { log } = foldEventsIntoLog(
      [],
      [
        {
          type: 'action.invalid',
          eventId: 'e1',
          commandId: 'command.temper-1',
          reason: 'temper.unavailable',
        },
        {
          type: 'action.invalid',
          eventId: 'e2',
          commandId: 'command.temper-2',
          reason: 'temper.capped',
        },
      ],
      0,
    );
    expect(log.map((line) => line.text)).toEqual([
      'The Deep has given you nothing to spend.',
      'That part of you can harden no further.',
    ]);
  });
});
