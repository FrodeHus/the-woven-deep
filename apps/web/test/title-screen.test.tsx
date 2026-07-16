import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { createNewRun, DEFAULT_GUEST_HERO, encodeActiveRun, type Uint32State } from '@woven-deep/engine';
import { TitleScreen } from '../src/ui/screens/TitleScreen.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function fakeStorage(initial: string | null = null): SessionStorageLike {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SAVE_KEY, initial);
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => { values.set(key, value); },
  };
}

function decodableSave(): string {
  return encodeActiveRun(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
}

describe('TitleScreen', () => {
  it('always renders Enter the Deep and Hall of Records', () => {
    render(
      <TitleScreen storage={fakeStorage()} onEnterTheDeep={vi.fn()} onContinue={vi.fn()} onHall={vi.fn()} />,
    );

    expect(screen.getByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /hall of records/i })).toBeInTheDocument();
  });

  it('does not render Continue when storage holds no save', () => {
    render(
      <TitleScreen storage={fakeStorage()} onEnterTheDeep={vi.fn()} onContinue={vi.fn()} onHall={vi.fn()} />,
    );

    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('does not render Continue when the stored save does not decode cleanly', () => {
    render(
      <TitleScreen
        storage={fakeStorage('{"not": "a save"}')}
        onEnterTheDeep={vi.fn()}
        onContinue={vi.fn()}
        onHall={vi.fn()}
      />,
    );

    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('renders Continue when the stored save decodes cleanly, built with the real engine + codec', () => {
    render(
      <TitleScreen
        storage={fakeStorage(decodableSave())}
        onEnterTheDeep={vi.fn()}
        onContinue={vi.fn()}
        onHall={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: /continue/i })).toBeInTheDocument();
  });

  it('dispatches the right navigation callback for each option via keyboard selection', async () => {
    const user = userEvent.setup();
    const onEnterTheDeep = vi.fn();
    const onContinue = vi.fn();
    const onHall = vi.fn();

    render(
      <TitleScreen
        storage={fakeStorage(decodableSave())}
        onEnterTheDeep={onEnterTheDeep}
        onContinue={onContinue}
        onHall={onHall}
      />,
    );

    // The first option (Enter the Deep) auto-focuses on mount.
    expect(screen.getByRole('option', { name: /enter the deep/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onEnterTheDeep).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onContinue).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onHall).toHaveBeenCalledTimes(1);
  });
});
