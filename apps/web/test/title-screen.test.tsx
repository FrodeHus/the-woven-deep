import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  createNewRun,
  DEFAULT_GUEST_HERO,
  encodeActiveRun,
  type Uint32State,
} from '@woven-deep/engine';
import { TitleScreen, type TitleScreenProps } from '../src/ui/screens/TitleScreen.js';
import { GUEST_ACCOUNT, type AccountState } from '../src/session/account.js';
import { SAVE_KEY, type SessionStorageLike } from '../src/session/storage.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const SIGNED_IN_ACCOUNT: AccountState = {
  ...GUEST_ACCOUNT,
  status: 'signed-in',
  email: 'player@example.com',
  csrfToken: 'tok',
  unlockedClassIds: [],
};

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../content'),
  });
});

function fakeStorage(initial: string | null = null): SessionStorageLike {
  const values = new Map<string, string>();
  if (initial !== null) values.set(SAVE_KEY, initial);
  return {
    get: (key: string) => values.get(key) ?? null,
    set: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

function decodableSave(): string {
  return encodeActiveRun(createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO }));
}

/** Fills in the guest-account/callback props every pre-existing test in this file never cared
 * about, so those tests stay focused on Continue/Enter-the-Deep/Hall behavior while still
 * satisfying `TitleScreenProps`'s now-required `account`/`onSignIn`/`onSignOut`. */
function renderTitle(
  overrides: Partial<TitleScreenProps> & { storage: SessionStorageLike },
): ReturnType<typeof render> {
  return render(
    <TitleScreen
      onEnterTheDeep={vi.fn()}
      onContinue={vi.fn()}
      onHall={vi.fn()}
      account={GUEST_ACCOUNT}
      onSignIn={vi.fn()}
      onSignOut={vi.fn()}
      {...overrides}
    />,
  );
}

describe('TitleScreen', () => {
  it('always renders Enter the Deep and Hall of Records', () => {
    renderTitle({ storage: fakeStorage() });

    expect(screen.getByRole('option', { name: /enter the deep/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /hall of records/i })).toBeInTheDocument();
  });

  it('does not render Continue when storage holds no save', () => {
    renderTitle({ storage: fakeStorage() });

    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('does not render Continue when the stored save does not decode cleanly', () => {
    renderTitle({ storage: fakeStorage('{"not": "a save"}') });

    expect(screen.queryByRole('option', { name: /continue/i })).not.toBeInTheDocument();
  });

  it('renders Continue when the stored save decodes cleanly, built with the real engine + codec', () => {
    renderTitle({ storage: fakeStorage(decodableSave()) });

    expect(screen.getByRole('option', { name: /continue/i })).toBeInTheDocument();
  });

  it('dispatches the right navigation callback for each option via keyboard selection', async () => {
    const user = userEvent.setup();
    const onEnterTheDeep = vi.fn();
    const onContinue = vi.fn();
    const onHall = vi.fn();

    renderTitle({
      storage: fakeStorage(decodableSave()),
      onEnterTheDeep,
      onContinue,
      onHall,
    });

    // The first option (Enter the Deep) auto-focuses on mount.
    expect(screen.getByRole('option', { name: /enter the deep/i })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onEnterTheDeep).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onContinue).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onHall).toHaveBeenCalledTimes(1);
  });

  describe('signed-in identity', () => {
    it('shows "Sign in with email" and no email/Sign-out when guest', () => {
      renderTitle({ storage: fakeStorage(), account: GUEST_ACCOUNT });

      expect(screen.getByRole('option', { name: /sign in with email/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /sign out/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/signed in as/i)).not.toBeInTheDocument();
    });

    it('shows the email and "Sign out", and no "Sign in" option, when signed in', () => {
      renderTitle({ storage: fakeStorage(), account: SIGNED_IN_ACCOUNT });

      expect(screen.getByText(/signed in as/i)).toHaveTextContent('player@example.com');
      expect(screen.getByRole('option', { name: /sign out/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /sign in with email/i })).not.toBeInTheDocument();
    });

    it('invokes onSignIn when the "Sign in with email" option is selected', async () => {
      const user = userEvent.setup();
      const onSignIn = vi.fn();
      renderTitle({ storage: fakeStorage(), account: GUEST_ACCOUNT, onSignIn });

      await user.click(screen.getByRole('option', { name: /sign in with email/i }));
      expect(onSignIn).toHaveBeenCalledTimes(1);
    });

    it('invokes onSignOut when the "Sign out" option is selected', async () => {
      const user = userEvent.setup();
      const onSignOut = vi.fn();
      renderTitle({ storage: fakeStorage(), account: SIGNED_IN_ACCOUNT, onSignOut });

      await user.click(screen.getByRole('option', { name: /sign out/i }));
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });
  });
});
