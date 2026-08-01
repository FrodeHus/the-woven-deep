import { resolve } from 'node:path';
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  encodeActiveRun,
  type ActiveRun,
  type Uint32State,
} from '@woven-deep/engine';
import { App } from '../src/App.js';
import { DeathOverlay } from '../src/ui/overlays/DeathOverlay.js';
import { createSessionRunRecordRepository } from '../src/session/run-records-storage.js';
import { CHECKPOINT_KEY, SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  window.localStorage.clear();
  window.sessionStorage.clear();
});

function packFetcher(): typeof fetch {
  return vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify(pack))),
  ) as unknown as typeof fetch;
}

function fakeStorage(
  initial: string | null = null,
): SessionStorageLike & { peek(key?: string): string | null } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SAVE_KEY, initial);
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
    remove: (key: string) => {
      values.delete(key);
    },
    peek: (key: string = SAVE_KEY) => values.get(key) ?? null,
  };
}

/** A Wanderer run already concluded by hero death, beside the floor-entry checkpoint it can rise
 * from -- the exact storage shape a Wanderer death leaves behind. */
function wandererDeathStorage(seed: Uint32State = SEED): ReturnType<typeof fakeStorage> {
  const fresh: ActiveRun = createNewRun({
    pack,
    seed,
    hero: DEFAULT_GUEST_HERO,
    mode: 'wanderer',
  });
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  const dead: ActiveRun = {
    ...fresh,
    actors: fresh.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
    ),
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
      concludedAtRevision: fresh.revision,
      finalized: false,
    },
  };
  const storage = fakeStorage(encodeActiveRun(dead));
  storage.set(CHECKPOINT_KEY, encodeActiveRun(fresh));
  return storage;
}

/** A Wanderer run concluded by VICTORY (breaking the cycle), beside a live checkpoint -- only a
 * Wanderer DEATH is the player's decision; every other conclusion, this one included, still
 * finalizes and navigates on sight. */
function wandererVictoryStorage(seed: Uint32State = SEED): ReturnType<typeof fakeStorage> {
  const fresh: ActiveRun = createNewRun({
    pack,
    seed,
    hero: DEFAULT_GUEST_HERO,
    mode: 'wanderer',
  });
  const won: ActiveRun = {
    ...fresh,
    conclusion: {
      completionType: 'broke-cycle',
      cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
      concludedAtRevision: fresh.revision,
      finalized: false,
    },
  };
  const storage = fakeStorage(encodeActiveRun(won));
  storage.set(CHECKPOINT_KEY, encodeActiveRun(fresh));
  return storage;
}

/** A run already concluded by hero death -- mirrors `app-boot.test.tsx`'s `deadRunSave` fixture. */
function deadRunSave(seed: Uint32State = SEED): string {
  const fresh: ActiveRun = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  return encodeActiveRun({
    ...fresh,
    actors: fresh.actors.map((actor) =>
      actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor,
    ),
    conclusion: {
      completionType: 'died',
      cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
      concludedAtRevision: fresh.revision,
      finalized: false,
    },
  });
}

/** A run concluded by a non-death completion (breaking the cycle at the Final Chamber) -- same
 * shape as `deadRunSave` apart from `completionType` and the hero staying alive, to exercise the
 * "non-death conclusions navigate immediately, no overlay" branch of the death-overlay gate. */
function brokeCycleRunSave(seed: Uint32State = SEED): string {
  const fresh: ActiveRun = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
  return encodeActiveRun({
    ...fresh,
    conclusion: {
      completionType: 'broke-cycle',
      cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
      concludedAtRevision: fresh.revision,
      finalized: false,
    },
  });
}

describe('DeathOverlay (unit)', () => {
  it('renders the alertdialog with the expected copy and focuses itself on mount', () => {
    render(<DeathOverlay onAcknowledge={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: /the deep takes you/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/THE DEEP TAKES YOU/);
    expect(dialog).toHaveTextContent(/the Weave remembers/i);
    expect(dialog).toHaveFocus();
  });

  it('calls onAcknowledge exactly once on click, even if clicked twice', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} />);
    const dialog = screen.getByRole('alertdialog');
    await user.click(dialog);
    await user.click(dialog);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('calls onAcknowledge exactly once on Enter keydown, even if pressed twice', () => {
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} />);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('keeps the single acknowledge in classic', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} />);
    expect(screen.queryByRole('button', { name: /Rise again/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('alertdialog'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('offers rise and accept in wanderer, with rise focused', async () => {
    const user = userEvent.setup();
    const onRise = vi.fn();
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} onRise={onRise} />);
    const rise = screen.getByRole('button', { name: /Rise again/ });
    expect(rise).toHaveFocus();
    await user.click(rise);
    expect(onRise).toHaveBeenCalledTimes(1);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('accepts death from the second action', async () => {
    const user = userEvent.setup();
    const onRise = vi.fn();
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} onRise={onRise} />);
    await user.click(screen.getByRole('button', { name: /Accept death/ }));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    expect(onRise).not.toHaveBeenCalled();
  });

  it('does not dismiss on a background click when two actions are offered', async () => {
    const user = userEvent.setup();
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} onRise={vi.fn()} />);
    await user.click(screen.getByRole('alertdialog'));
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('does not double-fire when both Enter and a click land', () => {
    const onAcknowledge = vi.fn();
    render(<DeathOverlay onAcknowledge={onAcknowledge} />);
    const dialog = screen.getByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    fireEvent.click(dialog);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });
});

describe('Death overlay gates conclusion navigation (App integration)', () => {
  it('shows the death overlay (not the conclusion screen) immediately on a death conclusion, and only navigates to the conclusion screen once acknowledged', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(deadRunSave());

    render(<App fetcher={packFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    const overlay = await screen.findByRole('alertdialog', { name: /the deep takes you/i });
    expect(overlay).toBeInTheDocument();
    expect(screen.queryByText(/you have fallen/i)).not.toBeInTheDocument();

    // The run is already finalized (written to the Hall) even though navigation hasn't happened.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(1);

    await user.click(overlay);

    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Acknowledging never re-finalizes: still exactly one Hall record.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(1);
  });

  it('acknowledging via Enter also navigates to the conclusion screen', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(deadRunSave());

    render(<App fetcher={packFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    await screen.findByRole('alertdialog', { name: /the deep takes you/i });
    await user.keyboard('{Enter}');

    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
  });

  it('a wanderer death offers the choice, finalizes nothing until it is made, and rising returns to play', async () => {
    const user = userEvent.setup();
    const storage = wandererDeathStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await user.click(await screen.findByRole('option', { name: /continue/i }));

    await screen.findByRole('alertdialog', { name: /the deep takes you/i });
    // Nothing is written to the Hall while the choice is still open.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /rise again/i }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/you have fallen/i)).not.toBeInTheDocument();
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(0);
  });

  it('accepting a wanderer death finalizes navigation, retires the checkpoint, but never touches the Hall', async () => {
    const user = userEvent.setup();
    const storage = wandererDeathStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await user.click(await screen.findByRole('option', { name: /continue/i }));

    await screen.findByRole('alertdialog', { name: /the deep takes you/i });
    await user.click(screen.getByRole('button', { name: /accept death/i }));

    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    // The Hall is Classic-only: an accepted Wanderer death never appends a record.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(0);
    expect(storage.peek(CHECKPOINT_KEY)).toBeNull();
  });

  it('a wanderer VICTORY still navigates immediately with no choice offered, but never touches the Hall', async () => {
    const user = userEvent.setup();
    const storage = wandererVictoryStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await user.click(await screen.findByRole('option', { name: /continue/i }));

    expect(await screen.findByText(/you have broken the cycle/i)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rise again/i })).not.toBeInTheDocument();
    // The Hall is Classic-only: a Wanderer victory never appends a record either.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(0);
    // The run is over for good, so its rewind point is retired with it.
    expect(storage.peek(CHECKPOINT_KEY)).toBeNull();
  });

  it('a non-death conclusion (broke-cycle) renders no overlay and routes straight to the conclusion screen', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(brokeCycleRunSave());

    render(<App fetcher={packFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    expect(await screen.findByText(/you have broken the cycle/i)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
