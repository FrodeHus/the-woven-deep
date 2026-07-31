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
let baseRun: ActiveRun;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../content'),
  });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: baseRun, content: pack });
});

function snapshot(projection: GameplayProjection = baseProjection): SessionSnapshot {
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
  };
}

function stubSession(projection?: GameplayProjection): {
  session: GuestSession;
  dispatch: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn();
  const snap = snapshot(projection);
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
    talkAvailable?: boolean;
    onOpenChange?: (open: boolean) => void;
    onOpenOverlay?: (overlay: string) => void;
    onCast?: (spellId: string) => void;
    onStartExplore?: () => void;
    onTravelToStairs?: (direction: 'up' | 'down') => void;
    projection?: GameplayProjection;
  }> = {},
) {
  const { session, dispatch } = stubSession(overrides.projection);
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onOpenOverlay = overrides.onOpenOverlay ?? vi.fn();
  const onCast = overrides.onCast ?? vi.fn();
  const onStartExplore = overrides.onStartExplore ?? vi.fn();
  const onTravelToStairs = overrides.onTravelToStairs ?? vi.fn();
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
        talkAvailable={overrides.talkAvailable ?? false}
        onCast={onCast}
        onStartExplore={onStartExplore}
        onTravelToStairs={onTravelToStairs}
      />
    </UiProviders>,
  );
  return { dispatch, onOpenChange, onOpenOverlay, onCast, onStartExplore, onTravelToStairs };
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

  it('shows no Cast entries for a spell-less hero', () => {
    harness();
    expect(screen.queryByText(/^Cast:/)).not.toBeInTheDocument();
  });

  it('shows a "Cast: Ember bolt" entry for a caster and invokes onCast(spellId) on select', async () => {
    const caster: ActiveRun = {
      ...baseRun,
      hero: { ...baseRun.hero, knownSpellIds: ['spell.ember-bolt'] },
    };
    const projection = projectGameplayState({ state: caster, content: pack });
    const user = userEvent.setup();
    const { onCast, onOpenChange } = harness({ projection });

    const entry = screen.getByText('Cast: Ember bolt');
    expect(entry).toBeInTheDocument();
    await user.click(entry);

    expect(onCast).toHaveBeenCalledWith('spell.ember-bolt');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('labels the descend entry "Descend / go to down stairs" with no pending recall anchor', () => {
    harness();
    expect(screen.getByText('Descend / go to down stairs')).toBeInTheDocument();
  });

  it('relabels the descend entry "Return to depth N" when a recall anchor is set', () => {
    const anchor = baseRun.floors[0]!;
    const anchored: ActiveRun = { ...baseRun, returnAnchorFloorId: anchor.floorId };
    const projection = projectGameplayState({ state: anchored, content: pack });
    harness({ projection });

    expect(screen.getByText(`Return to depth ${anchor.depth}`)).toBeInTheDocument();
    expect(screen.queryByText('Descend / go to down stairs')).not.toBeInTheDocument();
  });

  it('omits the Cast entry when the hero cannot afford its Weave cost', () => {
    const heroActorId = baseRun.hero.actorId;
    const caster: ActiveRun = {
      ...baseRun,
      hero: { ...baseRun.hero, knownSpellIds: ['spell.ember-bolt'] },
      actors: baseRun.actors.map((actor) =>
        actor.actorId === heroActorId ? { ...actor, weave: 0 } : actor,
      ),
    };
    const projection = projectGameplayState({ state: caster, content: pack });
    harness({ projection });

    expect(screen.queryByText('Cast: Ember bolt')).not.toBeInTheDocument();
  });

  it('typing "explore" and Enter starts auto-explore and closes the palette', async () => {
    const user = userEvent.setup();
    const { onStartExplore, onOpenChange, dispatch } = harness();

    await user.type(screen.getByRole('combobox'), 'explore');
    await user.keyboard('{Enter}');

    expect(onStartExplore).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // A discovery surface, not a parallel command path: no intent is dispatched for this entry.
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('selecting the descend entry calls onTravelToStairs("down") instead of dispatching the raw descend intent', async () => {
    const user = userEvent.setup();
    const { onTravelToStairs, onOpenChange, dispatch } = harness();

    await user.type(screen.getByRole('combobox'), 'descend');
    await user.keyboard('{Enter}');

    expect(onTravelToStairs).toHaveBeenCalledWith('down');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('selecting the ascend entry calls onTravelToStairs("up") instead of dispatching the raw ascend intent', async () => {
    const user = userEvent.setup();
    const { onTravelToStairs, onOpenChange, dispatch } = harness();

    await user.type(screen.getByRole('combobox'), 'ascend');
    await user.keyboard('{Enter}');

    expect(onTravelToStairs).toHaveBeenCalledWith('up');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
