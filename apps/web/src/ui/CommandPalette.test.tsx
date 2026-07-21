import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  DEFAULT_GUEST_HERO,
  createNewRun,
  projectGameplayState,
  type ActiveRun,
  type GameplayProjection,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../session/settings.js';
import { UiProviders } from './providers.js';
import { CommandPalette } from './CommandPalette.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
  const baseRun: ActiveRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function snapshot(): SessionSnapshot {
  return {
    projection: baseProjection,
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
  };
}

function stubSession(): { session: GuestSession; dispatch: ReturnType<typeof vi.fn> } {
  const dispatch = vi.fn();
  const snap = snapshot();
  const session = {
    getSnapshot: () => snap,
    subscribe: () => () => {},
    dispatch,
  } as unknown as GuestSession;
  return { session, dispatch };
}

function harness(
  overrides: Readonly<{
    isTownContext?: boolean;
    tradeAvailable?: boolean;
    onOpenChange?: (open: boolean) => void;
    onOpenOverlay?: (overlay: string) => void;
  }> = {},
) {
  const { session, dispatch } = stubSession();
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onOpenOverlay = overrides.onOpenOverlay ?? vi.fn();
  render(
    <UiProviders
      pack={pack}
      settings={DEFAULT_SETTINGS}
      onChangeSettings={() => {}}
      session={session}
    >
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        onOpenOverlay={onOpenOverlay as never}
        isTownContext={overrides.isTownContext ?? false}
        tradeAvailable={overrides.tradeAvailable ?? false}
      />
    </UiProviders>,
  );
  return { dispatch, onOpenChange, onOpenOverlay };
}

describe('CommandPalette', () => {
  it('renders inside a dialog with the expected test id', () => {
    harness();
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
  });

  it('filters to the Inventory entry when typing "inv", showing its bound chord, and Enter opens it then closes the palette', async () => {
    const user = userEvent.setup();
    const { onOpenOverlay, onOpenChange } = harness();

    await user.type(screen.getByRole('combobox'), 'inv');

    const entry = screen.getByText('Inventory').closest('[cmdk-item]')!;
    expect(entry).toHaveTextContent('i');
    expect(screen.queryByText('Rest')).not.toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(onOpenOverlay).toHaveBeenCalledWith('inventory');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('typing "rest" and Enter dispatches { type: "rest" } via session.dispatch', async () => {
    const user = userEvent.setup();
    const { dispatch, onOpenChange } = harness();

    await user.type(screen.getByRole('combobox'), 'rest');
    await user.keyboard('{Enter}');

    expect(dispatch).toHaveBeenCalledWith({ type: 'rest' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('omits the trade entry when tradeAvailable is false, and shows it when true', () => {
    harness({ tradeAvailable: false });
    expect(screen.queryByText('Trade')).not.toBeInTheDocument();

    harness({ tradeAvailable: true });
    expect(screen.getByText('Trade')).toBeInTheDocument();
  });

  it('omits the house entry outside town context, and shows it when isTownContext is true', () => {
    harness({ isTownContext: false });
    expect(screen.queryByText('House/Town')).not.toBeInTheDocument();

    harness({ isTownContext: true });
    expect(screen.getByText('House/Town')).toBeInTheDocument();
  });
});
