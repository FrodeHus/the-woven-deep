import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState } from '@woven-deep/engine';
import type { GameplayProjection } from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../src/session/guest-session.js';
import type { RunSession } from '../src/session/run-session.js';
import type { PlayerIntent } from '../src/session/intents.js';
import { PlayScreen } from '../src/ui/PlayScreen.js';
import { fakePlayfieldRenderer } from './fake-playfield-renderer.js';
import { withUiProviders } from './with-ui-providers.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

interface FakePotion {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly condition: number;
  readonly fuel: null;
  readonly enabled: null;
  readonly identified: boolean;
}

function potion(itemId: string): FakePotion {
  return {
    itemId,
    name: `Potion ${itemId}`,
    category: 'potion',
    quantity: 1,
    condition: 100,
    fuel: null,
    enabled: null,
    identified: true,
  };
}

function projectionOf(backpack: readonly FakePotion[]): GameplayProjection {
  return {
    ...baseProjection,
    hero: { ...baseProjection.hero, backpack },
    trade: undefined,
  } as unknown as GameplayProjection;
}

function snapshotOf(projection: GameplayProjection): SessionSnapshot {
  return {
    projection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    pendingFinalChamberChoice: null,
    notice: null,
    houseOpen: false,
    conclusion: null,
    sightings: { monsterIds: [], itemIds: [], landmarks: [] },
    heroClassTags: [],
    onboarding: { counts: {}, dismissed: [] },
  } as unknown as SessionSnapshot;
}

class FakeSession {
  public readonly dispatched: PlayerIntent[] = [];
  private readonly snapshot: SessionSnapshot;

  constructor(projection: GameplayProjection) {
    this.snapshot = snapshotOf(projection);
  }

  subscribe(): () => void {
    return () => {};
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot;
  }

  dispatch(intent: PlayerIntent): void {
    this.dispatched.push(intent);
  }

  setHouseOpen(): void {}
  recordOnboardingIntent(): void {}
  dismissOnboardingHint(): void {}
  answerDecision(): void {}
}

async function renderPlay(session: FakeSession): Promise<void> {
  const fake = fakePlayfieldRenderer();
  render(
    withUiProviders(
      pack,
      <PlayScreen
        session={session as unknown as GuestSession}
        pack={pack}
        createRenderer={fake.createRenderer}
      />,
      undefined,
      session as unknown as RunSession,
    ),
  );
  await screen.findByRole('img', { name: /dungeon/i });
}

describe('belt keybind', () => {
  it('pressing "1" drinks the first potion in the backpack', async () => {
    const session = new FakeSession(projectionOf([potion('potion.a'), potion('potion.b')]));
    await renderPlay(session);

    act(() => fireEvent.keyDown(window, { key: '1', code: 'Digit1' }));

    expect(session.dispatched).toEqual([{ type: 'backpack', action: 'use', itemId: 'potion.a' }]);
  });

  it('pressing "1" with no potions in the backpack dispatches nothing', async () => {
    const session = new FakeSession(projectionOf([]));
    await renderPlay(session);

    act(() => fireEvent.keyDown(window, { key: '1', code: 'Digit1' }));

    expect(session.dispatched).toEqual([]);
  });

  it('ignores non-potion backpack items for the belt (only potions fill slot 1)', async () => {
    const nonPotion = { ...potion('sword.a'), category: 'weapon' };
    const session = new FakeSession(projectionOf([nonPotion, potion('potion.a')]));
    await renderPlay(session);

    act(() => fireEvent.keyDown(window, { key: '1', code: 'Digit1' }));

    expect(session.dispatched).toEqual([{ type: 'backpack', action: 'use', itemId: 'potion.a' }]);
  });

  it('numpad Numpad1 still moves southwest instead of drinking a potion', async () => {
    const session = new FakeSession(projectionOf([potion('potion.a')]));
    await renderPlay(session);

    act(() => fireEvent.keyDown(window, { key: '1', code: 'Numpad1' }));

    expect(session.dispatched).toEqual([{ type: 'move', direction: 'southwest' }]);
  });
});
