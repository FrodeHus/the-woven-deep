import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { ActionBar } from '../src/ui/panels/ActionBar.js';
import { resolveKeymap } from '../src/session/settings.js';
import type { RunSession } from '../src/session/run-session.js';
import type { PlayerIntent } from '../src/session/intents.js';

const KEYMAP = resolveKeymap({});

interface FakeItem {
  readonly itemId: string;
  readonly name: string;
  readonly category: string;
  readonly quantity: number;
  readonly glyph?: string;
}

function potion(itemId: string, quantity = 1): FakeItem {
  return { itemId, name: `Potion ${itemId}`, category: 'potion', quantity, glyph: '!' };
}

function snapshotOf(overrides: {
  backpack?: readonly FakeItem[];
  castableSpells?: readonly { spellId: string; name: string }[];
  health?: number;
  maxHealth?: number;
  weave?: number;
  maxWeave?: number;
}): never {
  return {
    projection: {
      hero: {
        backpack: overrides.backpack ?? [],
        castableSpells: overrides.castableSpells,
        health: overrides.health ?? 10,
        maxHealth: overrides.maxHealth ?? 10,
        weave: overrides.weave ?? 5,
        maxWeave: overrides.maxWeave ?? 5,
      },
    },
  } as never;
}

function fakeSession(): RunSession & { readonly dispatched: PlayerIntent[] } {
  const dispatched: PlayerIntent[] = [];
  return {
    dispatched,
    getSnapshot: vi.fn() as never,
    subscribe: vi.fn() as never,
    dispatch: (intent) => dispatched.push(intent),
    answerDecision: vi.fn(),
    chooseFinalChamber: vi.fn(),
    setHouseOpen: vi.fn(),
    finalizeConcludedRun: vi.fn() as never,
    recordOnboardingIntent: vi.fn(),
    dismissOnboardingHint: vi.fn(),
    revealLore: vi.fn(),
  };
}

describe('ActionBar', () => {
  it('shows up to four potion slots from the hero backpack', () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({ backpack: [potion('p1'), potion('p2')] })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    expect(screen.getByTestId('belt-slot-0')).toBeInTheDocument();
    expect(screen.getByTestId('belt-slot-1')).toBeInTheDocument();
    expect(screen.getByTestId('belt-slot-2')).toBeInTheDocument();
    expect(screen.getByTestId('belt-slot-3')).toBeInTheDocument();
  });

  it('caps the belt at four slots even with more potions in the backpack', () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({
          backpack: [potion('p1'), potion('p2'), potion('p3'), potion('p4'), potion('p5')],
        })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('belt-slot-4')).not.toBeInTheDocument();
  });

  it('clicking a filled slot dispatches a backpack-use intent for that potion', async () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({ backpack: [potion('p1'), potion('p2')] })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('belt-slot-1'));
    expect(session.dispatched).toEqual([{ type: 'backpack', action: 'use', itemId: 'p2' }]);
  });

  it('renders empty slots inert -- clicking one dispatches nothing', async () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({ backpack: [potion('p1')] })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('belt-slot-1'));
    expect(session.dispatched).toEqual([]);
  });

  it('hides the cast button when the hero has no castable spells', () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({ castableSpells: [] })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('cast-button')).not.toBeInTheDocument();
  });

  it('also hides the cast button when castableSpells is absent', () => {
    const session = fakeSession();
    render(
      <ActionBar snapshot={snapshotOf({})} session={session} keymap={KEYMAP} onBeginCast={vi.fn()} />,
    );
    expect(screen.queryByTestId('cast-button')).not.toBeInTheDocument();
  });

  it('shows a cast button for the first castable spell and begins targeting for it on click', async () => {
    const session = fakeSession();
    const onBeginCast = vi.fn();
    render(
      <ActionBar
        snapshot={snapshotOf({
          castableSpells: [
            { spellId: 'spell.ember-bolt', name: 'Ember bolt' },
            { spellId: 'spell.fireball', name: 'Fireball' },
          ],
        })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={onBeginCast}
      />,
    );
    const button = screen.getByTestId('cast-button');
    expect(button).toHaveTextContent('Ember bolt');
    await userEvent.click(button);
    expect(onBeginCast).toHaveBeenCalledWith('spell.ember-bolt');
    expect(onBeginCast).toHaveBeenCalledTimes(1);
  });

  it('renders a hint line built from the resolved keymap, not hardcoded chords', () => {
    const session = fakeSession();
    const rebound = resolveKeymap({ 'use-belt-1': { key: 'q', shift: false } });
    render(
      <ActionBar snapshot={snapshotOf({})} session={session} keymap={rebound} onBeginCast={vi.fn()} />,
    );
    expect(screen.getByText(/q drink/i)).toBeInTheDocument();
    expect(screen.queryByText(/\b1 drink\b/i)).not.toBeInTheDocument();
  });

  it('shows the life-thread and weave gauges', () => {
    const session = fakeSession();
    render(
      <ActionBar
        snapshot={snapshotOf({ health: 7, maxHealth: 10, weave: 2, maxWeave: 4 })}
        session={session}
        keymap={KEYMAP}
        onBeginCast={vi.fn()}
      />,
    );
    expect(screen.getByTestId('gauge-hp')).toHaveTextContent('7 / 10');
    expect(screen.getByTestId('gauge-weave')).toHaveTextContent('2 / 4');
  });
});
