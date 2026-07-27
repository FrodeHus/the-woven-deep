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
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

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
    peek: (key: string = SAVE_KEY) => values.get(key) ?? null,
  };
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
