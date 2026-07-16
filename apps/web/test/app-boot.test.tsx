import { resolve } from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun, decodeActiveRun, DEFAULT_GUEST_HERO, encodeActiveRun, type Uint32State,
} from '@woven-deep/engine';
import { App, PORTRAIT_KEY } from '../src/App.js';
import { PORTRAIT_GLYPHS } from '../src/session/wizard-reducer.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

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

  it('does not offer Continue when the stored save is corrupt', async () => {
    const storage = fakeStorage('{"not": "a save"}');
    render(<App fetcher={packFetcher()} storage={storage} />);

    await screen.findByRole('option', { name: /enter the deep/i });
    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });
});
