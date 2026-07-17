import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, encodeActiveRun, heroFromChoices,
  type ActiveRun, type Uint32State,
} from '@woven-deep/engine';
import { App, PORTRAIT_KEY } from '../src/App.js';
import { createSessionRunRecordRepository, RECORDS_KEY } from '../src/session/run-records-storage.js';
import { PORTRAIT_GLYPHS } from '../src/session/wizard-reducer.js';
import { SETTINGS_KEY } from '../src/session/settings.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

vi.mock('@woven-deep/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@woven-deep/engine')>();
  return { ...actual, heroFromChoices: vi.fn(actual.heroFromChoices) };
});

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const WAYFARER = 'class.wayfarer';

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

function packFetcher(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(pack))) as unknown as typeof fetch;
}

function fakeStorage(initial: string | null = null): SessionStorageLike & { peek(key?: string): string | null } {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SAVE_KEY, initial);
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    peek: (key: string = SAVE_KEY) => values.get(key) ?? null,
  };
}

function decodableSave(seed: Uint32State = SEED): string {
  return encodeActiveRun(createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO }));
}

/** A `localStorage`-shaped fake, keyed like `fakeStorage` above but distinct (settings and the
 * onboarding ledger live in `localStorage`, never the run-save `sessionStorage`). `peek` defaults
 * to `SETTINGS_KEY` since that's this file's only `localStorage` fixture need today. */
function fakeLocalStorage(initial?: Readonly<{ key: string; value: string }>): SessionStorageLike & { peek(key?: string): string | null } {
  const values = new Map<string, string>();
  if (initial) values.set(initial.key, initial.value);
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
    peek: (key: string = SETTINGS_KEY) => values.get(key) ?? null,
  };
}

/** A run already concluded by hero death, exactly like `guest-session.test.ts`'s `deadRun`
 * fixture — a fresh real-pack run with the hero's health forced to 0 and a matching `died`
 * conclusion, built directly rather than driven to death by dispatching commands (see that
 * file's comment for why: this pack's fresh runs spawn population actors alongside the hero,
 * and a natural mid-transition starvation death drags in unrelated multi-actor machinery that
 * has nothing to do with the app-boot/finalize-once wiring this suite exercises). */
function deadRunSave(seed: Uint32State = SEED): string {
  const fresh: ActiveRun = createNewRun({ pack, seed, hero: DEFAULT_GUEST_HERO });
  const hero = fresh.actors.find((actor) => actor.playerControlled)!;
  return encodeActiveRun({
    ...fresh,
    actors: fresh.actors.map((actor) => (actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor)),
    conclusion: {
      completionType: 'died',
      // The fresh guest run starts in town (depth 0), and this fixture never moves the hero
      // anywhere else before killing them.
      cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
      concludedAtRevision: fresh.revision, finalized: false,
    },
  });
}

function wayfarerKit(): { kitId: string; name: string } {
  const entry = pack.entries.find((candidate) => candidate.kind === 'class' && candidate.id === WAYFARER) as {
    kits: readonly { kitId: string; name: string }[];
  };
  return entry.kits[0]!;
}

/** Drives the full seven-step wizard via the keyboard/UI, exactly like `chargen-screen.test.tsx`,
 * up to (but not including) the final Confirm click, so callers can assert on the portrait choice
 * or intercept the Confirm click themselves. */
async function driveWizardToSummary(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Name'), 'Rin');
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('option', { name: /Roll/ }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('button', { name: 'Roll attributes' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('option', { name: /Wayfarer/ }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  const kit = wayfarerKit();
  await user.click(screen.getByRole('option', { name: kit.name }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  await user.click(screen.getByRole('option', { name: 'Caravan guard' }));
  await user.click(screen.getByRole('option', { name: 'Keen-eyed' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));

  expect(screen.getByLabelText(/Step 7 of 7/)).toBeInTheDocument();
}

describe('App boot flow', () => {
  it('shows a loading state, then the title screen when the pack loads (default boot: no params, no save)', async () => {
    render(<App fetcher={packFetcher()} storage={fakeStorage()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/binding|loading/i);

    expect(await screen.findByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /hall of records/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('shows a retry screen naming the failure when the pack fetch fails, and retries on Enter', async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('The content service is unavailable.'))
      .mockResolvedValueOnce(new Response(JSON.stringify(pack)));

    render(<App fetcher={fetcher as unknown as typeof fetch} storage={fakeStorage()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The content service is unavailable.');
    const retryButton = screen.getByRole('button', { name: /retry/i });

    retryButton.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('?quickstart=1 boots directly into play with a fresh default-hero session', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const storage = fakeStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: '.' });
    await waitFor(() => expect(storage.peek()).not.toBeNull());
    const saved = decodeActiveRun(storage.peek()!);
    expect(saved.hero.name).toBe(DEFAULT_GUEST_HERO.name);
  });

  it('?quickstart=1&seed=11.22.33.44 is deterministic', async () => {
    window.history.pushState({}, '', '/play?quickstart=1&seed=11.22.33.44');
    const storage = fakeStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    fireEvent.keyDown(window, { key: '.' });
    await waitFor(() => expect(storage.peek()).not.toBeNull());
    const saved = decodeActiveRun(storage.peek()!);
    expect(saved.runSeed).toEqual([11, 22, 33, 44]);
  });

  it('clearing the guest session while ?quickstart=1 is still in the URL lands on title and stays there -- it must not resurrect a hidden GuestSession that re-persists storage (regression: quickstart re-boot guard)', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const user = userEvent.setup();
    // A storage double that actually implements `remove` -- unlike this file's own `fakeStorage`
    // helper, `clearGuestSession` depends on it (see `clear-guest-session.ts`); the plain
    // no-`remove` double would silently no-op the wipe and mask the very bug this test targets.
    function removableStorage(): SessionStorageLike & { peek(): string | null } {
      const values = new Map<string, string>();
      return {
        get: (key: string) => values.get(key) ?? null,
        set: (key: string, value: string) => { values.set(key, value); },
        remove: (key: string) => { values.delete(key); },
        peek: () => values.get(SAVE_KEY) ?? null,
      };
    }
    const storage = removableStorage();
    const localStorage = removableStorage();

    render(<App fetcher={packFetcher()} storage={storage} localStorage={localStorage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    fireEvent.keyDown(window, { key: 'o' });
    await screen.findByRole('dialog', { name: 'Settings' });
    await user.type(screen.getByLabelText(/type "clear" to confirm/i), 'clear');
    await user.click(screen.getByRole('button', { name: 'Clear guest session' }));

    // A correct wipe lands on (and stays on) the title screen -- a hidden GuestSession
    // re-constructed by the surviving `?quickstart=1` query would instead bounce straight back
    // into play.
    expect(await screen.findByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: /dungeon/i })).not.toBeInTheDocument();

    // The wiped keys must stay wiped -- a resurrected session's constructor persists sightings
    // (and would persist a save/command-counter on any further dispatch) even with no player
    // input at all.
    expect(storage.peek()).toBeNull();
    expect(storage.get('woven-deep.guest-codex')).toBeNull();
  });

  it('shows the save-discarded notice from the session as a dismissible banner (via quickstart)', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const user = userEvent.setup();
    const storage = fakeStorage('{"not": "a save"}');
    render(<App fetcher={packFetcher()} storage={storage} />);

    await screen.findByRole('grid', { name: /dungeon/i });
    const banner = screen.getByRole('status', { name: /session/i });
    expect(banner).toHaveTextContent(/previous save/i);
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismiss);
    expect(screen.queryByText(/previous save/i)).not.toBeInTheDocument();
  });

  it('shows a persistent, non-dismissible warning (not the dismissible banner) when storage is unavailable, and play continues', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const storage: SessionStorageLike = {
      get: () => null,
      set: (): void => {
        throw new DOMException('nope', 'SecurityError');
      },
    };

    render(<App fetcher={packFetcher()} storage={storage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    fireEvent.keyDown(window, { key: '.' });

    const warning = await screen.findByRole('alert', { name: /storage/i });
    expect(warning).toHaveTextContent(/saving is unavailable/i);
    expect(within(warning).queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();

    expect(screen.getByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: /storage/i })).toBeInTheDocument();
  });

  it('shows the storage-full wording (distinct from unavailable) when a write throws a quota error', async () => {
    window.history.pushState({}, '', '/play?quickstart=1');
    const storage: SessionStorageLike = {
      get: () => null,
      set: () => {
        const error = new DOMException('quota', 'QuotaExceededError');
        throw error;
      },
    };

    render(<App fetcher={packFetcher()} storage={storage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    fireEvent.keyDown(window, { key: '.' });

    const warning = await screen.findByRole('alert', { name: /storage/i });
    expect(warning).toHaveTextContent(/storage is full/i);
  });

  it('reads a test-only seed from the query string (?seed=11.22.33.44) via quickstart and passes it to the session', async () => {
    window.history.pushState({}, '', '/play?quickstart=1&seed=11.22.33.44');
    const storage = fakeStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    fireEvent.keyDown(window, { key: '.' });

    await waitFor(() => expect(storage.peek()).not.toBeNull());
    const saved = decodeActiveRun(storage.peek()!);
    expect(saved.runSeed).toEqual([11, 22, 33, 44]);
  });

  it('Enter the Deep mounts the chargen screen', async () => {
    const user = userEvent.setup();
    render(<App fetcher={packFetcher()} storage={fakeStorage()} />);

    await user.click(await screen.findByRole('option', { name: /enter the deep/i }));
    expect(await screen.findByLabelText(/Step 1 of 7/)).toBeInTheDocument();
  });

  it('completing the wizard constructs a GuestSession whose hero matches the choices', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage();
    render(<App fetcher={packFetcher()} storage={storage} />);

    await user.click(await screen.findByRole('option', { name: /enter the deep/i }));
    await screen.findByLabelText(/Step 1 of 7/);
    await driveWizardToSummary(user);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    // A fresh session doesn't persist until its first dispatch — force one (harmless: `.` waits).
    fireEvent.keyDown(window, { key: '.' });
    await waitFor(() => expect(storage.peek()).not.toBeNull());
    const saved = decodeActiveRun(storage.peek()!);
    expect(saved.hero.name).toBe('Rin');
    expect(saved.hero.classTags).toContain('wayfarer');
    expect(
      saved.items.some((item) => item.location.type === 'backpack' || item.location.type === 'equipped'),
    ).toBe(true);
  });

  it('persists the chosen portrait under PORTRAIT_KEY at confirm', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage();
    render(<App fetcher={packFetcher()} storage={storage} />);

    await user.click(await screen.findByRole('option', { name: /enter the deep/i }));
    await screen.findByLabelText(/Step 1 of 7/);

    // Pick a non-default portrait so persistence is actually exercised (not just a stale default).
    // The portrait buttons' visible glyph is `aria-hidden`, so they carry no accessible name —
    // select by position within step 1's only listbox instead.
    const portraitOptions = screen.getAllByRole('option');
    expect(portraitOptions).toHaveLength(PORTRAIT_GLYPHS.length);
    await user.click(portraitOptions[1]!);
    await driveWizardToSummary(user);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByRole('grid', { name: /dungeon/i });
    expect(storage.peek(PORTRAIT_KEY)).toBe(PORTRAIT_GLYPHS[1]);
  });

  it('Continue resumes the stored run and is only offered when the save decodes cleanly', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(decodableSave());

    render(<App fetcher={packFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /session/i })).toHaveTextContent(/restored/i);
  });

  it('surfaces a visible client-bug error state when heroFromChoices throws at chargen confirm, instead of crashing silently', async () => {
    const user = userEvent.setup();
    vi.mocked(heroFromChoices).mockImplementationOnce(() => {
      throw new Error('poisoned choices: boom');
    });

    render(<App fetcher={packFetcher()} storage={fakeStorage()} />);
    await user.click(await screen.findByRole('option', { name: /enter the deep/i }));
    await screen.findByLabelText(/Step 1 of 7/);
    await driveWizardToSummary(user);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/poisoned choices: boom/);
    expect(screen.queryByRole('grid', { name: /dungeon/i })).not.toBeInTheDocument();
  });

  it('does not offer Continue when the stored save is corrupt', async () => {
    const storage = fakeStorage('{"not": "a save"}');
    render(<App fetcher={packFetcher()} storage={storage} />);

    await screen.findByRole('option', { name: /enter the deep/i });
    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  describe('quickstart forces onboarding off (Task 8 review Finding 1)', () => {
    it('?quickstart=1 never shows the onboarding hint strip, even with settings onboarding stored "on"', async () => {
      window.history.pushState({}, '', '/play?quickstart=1');
      const storage = fakeStorage();
      const localStorage = fakeLocalStorage({
        key: SETTINGS_KEY,
        value: JSON.stringify({
          fontScale: 1, reducedMotion: 'system', theme: 'tapestry', lighting: 'smooth',
          onboarding: 'on', bindings: {},
        }),
      });

      render(<App fetcher={packFetcher()} storage={storage} localStorage={localStorage} />);
      await screen.findByRole('grid', { name: /dungeon/i });

      expect(screen.queryByRole('note')).not.toBeInTheDocument();
    });

    it('contrast: a non-quickstart boot into a fresh town run shows the movement hint', async () => {
      const user = userEvent.setup();
      const storage = fakeStorage();
      render(<App fetcher={packFetcher()} storage={storage} />);

      await user.click(await screen.findByRole('option', { name: /enter the deep/i }));
      await screen.findByLabelText(/Step 1 of 7/);
      await driveWizardToSummary(user);
      await user.click(screen.getByRole('button', { name: 'Confirm' }));

      await screen.findByRole('grid', { name: /dungeon/i });
      expect(screen.getByRole('note')).toHaveTextContent(/move/i);
    });
  });

  describe('corrupted storage surfaces the standard dismissible notice (Task 8 review Finding 3)', () => {
    it('a corrupted settings blob resets to defaults AND shows a dismissible "Session notice" banner', async () => {
      const user = userEvent.setup();
      const storage = fakeStorage();
      const localStorage = fakeLocalStorage({ key: SETTINGS_KEY, value: 'not json{{{' });

      render(<App fetcher={packFetcher()} storage={storage} localStorage={localStorage} />);

      await screen.findByRole('option', { name: /enter the deep/i });
      const banner = screen.getByRole('status', { name: /settings/i });
      expect(banner).toHaveTextContent(/settings.*unreadable.*reset/i);

      const dismiss = within(banner).getByRole('button', { name: /dismiss/i });
      await user.click(dismiss);
      expect(screen.queryByText(/settings.*unreadable/i)).not.toBeInTheDocument();
    });
  });
});

/** StrictMode double-invokes the boot effect that calls this fetcher, and a plain
 * `mockResolvedValue` would hand back the SAME `Response` both times -- whose body can only be
 * read once. Build a fresh `Response` per call so double-invocation is harmless, exactly like a
 * real `fetch` would behave. */
function strictModeSafePackFetcher(): typeof fetch {
  return vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(pack)))) as unknown as typeof fetch;
}

describe('App finalize-once (concluded run)', () => {
  it('reaches the conclusion screen and appends exactly one Hall record under StrictMode double-effects, then a remount over the same storage shows the conclusion again without appending a second record', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(deadRunSave());

    // Render inside StrictMode explicitly: React double-invokes effects in dev/test StrictMode,
    // so this is exactly the environment the finalize-once guard (`GameRoot`'s `finalizedRef`,
    // plus the engine's own idempotent `finalizeConcludedRun`) has to survive.
    const first = render(
      <StrictMode>
        <App fetcher={strictModeSafePackFetcher()} storage={storage} />
      </StrictMode>,
    );

    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    // (a) the app switches to the conclusion screen.
    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: /dungeon/i })).not.toBeInTheDocument();

    // (b) exactly one record, even though StrictMode ran every effect twice.
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(1);

    first.unmount();

    // (c) a remount over the SAME storage (Continue into the now-finalized, still-dead run)
    // shows the conclusion screen again without appending a second record.
    render(
      <StrictMode>
        <App fetcher={strictModeSafePackFetcher()} storage={storage} />
      </StrictMode>,
    );
    const continueAgain = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueAgain);

    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    expect(createSessionRunRecordRepository(storage).records()).toHaveLength(1);
  });

  it('New Hero -> wizard -> Confirm starts the NEW hero fresh instead of restoring the dead save (regression: stale-save restore hijacking new-hero confirmation)', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage(deadRunSave());

    render(<App fetcher={strictModeSafePackFetcher()} storage={storage} />);

    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);
    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: 'New Hero' }));
    await screen.findByLabelText(/Step 1 of 7/);
    await driveWizardToSummary(user);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    // The PLAY screen mounts with the new hero, at turn 0 -- NOT the conclusion screen again.
    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(screen.queryByText(/you have fallen/i)).not.toBeInTheDocument();
    const heroPanel = screen.getByRole('region', { name: 'Hero' });
    expect(heroPanel).toHaveTextContent('Rin');
  });

  it('surfaces a persistent storage warning and still shows the conclusion screen (not a white screen) when the Hall write throws quota-style during finalize', async () => {
    const user = userEvent.setup();
    const backing = fakeStorage(deadRunSave());
    const storage: SessionStorageLike = {
      get: backing.get,
      set: (key: string, value: string) => {
        if (key === RECORDS_KEY) {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        backing.set(key, value);
      },
    };

    render(<App fetcher={strictModeSafePackFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    // No exception escapes, no white screen: the conclusion screen renders regardless.
    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    const warning = await screen.findByRole('alert', { name: /storage/i });
    expect(warning).toBeInTheDocument();
  });

  it('renders the conclusion screen with null score/heirloom (no throw) when Continue restores an already-finalized save whose Hall record is missing (empty Hall)', async () => {
    const user = userEvent.setup();
    const fresh: ActiveRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
    const hero = fresh.actors.find((actor) => actor.playerControlled)!;
    const alreadyFinalizedSave = encodeActiveRun({
      ...fresh,
      actors: fresh.actors.map((actor) => (actor.actorId === hero.actorId ? { ...actor, health: 0 } : actor)),
      conclusion: {
        completionType: 'died',
        cause: { killerContentId: null, depth: 0, turn: fresh.turn, worldTime: fresh.worldTime },
        concludedAtRevision: fresh.revision, finalized: true,
      },
    });
    const storage = fakeStorage(alreadyFinalizedSave);
    // The Hall itself is empty (never populated with a matching record) -- e.g. after a Hall reset.

    render(<App fetcher={strictModeSafePackFetcher()} storage={storage} />);
    const continueOption = await screen.findByRole('option', { name: /continue/i });
    await user.click(continueOption);

    expect(await screen.findByText(/you have fallen/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Heirloom' })).not.toBeInTheDocument();
  });
});
