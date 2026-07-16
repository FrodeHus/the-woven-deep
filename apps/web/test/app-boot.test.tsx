import { resolve } from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { decodeActiveRun } from '@woven-deep/engine';
import { App } from '../src/App.js';
import type { SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
});

function packFetcher(): typeof fetch {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(pack))) as unknown as typeof fetch;
}

function fakeStorage(initial: string | null = null): SessionStorageLike & { peek(): string | null } {
  let value = initial;
  return { get: () => value, set: (v: string) => { value = v; }, peek: () => value };
}

describe('App boot flow', () => {
  it('shows a loading state, then the play screen when the pack loads', async () => {
    render(<App fetcher={packFetcher()} storage={fakeStorage()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/binding|loading/i);
    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
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

    expect(await screen.findByRole('grid', { name: /dungeon/i })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('shows the save-discarded notice from the session as a dismissible banner', async () => {
    const user = userEvent.setup();
    const storage = fakeStorage('{"not": "a save"}');
    render(<App fetcher={packFetcher()} storage={storage} />);

    await screen.findByRole('grid', { name: /dungeon/i });
    const banner = screen.getByRole('status', { name: /session/i }) ?? screen.getByText(/previous save/i);
    expect(banner).toBeTruthy();
    const dismiss = screen.getByRole('button', { name: /dismiss/i });
    await user.click(dismiss);
    expect(screen.queryByText(/previous save/i)).not.toBeInTheDocument();
  });

  it('reads a test-only seed from the query string (?seed=11.22.33.44) and passes it to the session', async () => {
    window.history.pushState({}, '', '/?seed=11.22.33.44');
    const storage = fakeStorage();

    render(<App fetcher={packFetcher()} storage={storage} />);
    await screen.findByRole('grid', { name: /dungeon/i });

    // Force a persisted save by dispatching a harmless wait via the keyboard, then decode it to
    // confirm the seed reached GuestSession -> createNewRun.
    fireEvent.keyDown(window, { key: '.' });

    await waitFor(() => expect(storage.peek()).not.toBeNull());
    const saved = decodeActiveRun(storage.peek()!);
    expect(saved.runSeed).toEqual([11, 22, 33, 44]);
  });
});
