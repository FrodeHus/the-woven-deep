import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import {
  applyCondition, DEFAULT_GUEST_HERO, createNewRun, heroActor, projectGameplayState,
  type ActiveRun,
} from '@woven-deep/engine';
import type { GuestSession, SessionSnapshot } from '../../session/guest-session.js';
import { DEFAULT_SETTINGS } from '../../session/settings.js';
import { UiProviders } from '../providers.js';
import { CharacterSheetOverlay } from './CharacterSheetOverlay.js';

let pack: CompiledContentPack;
let baseRun: ActiveRun;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../../../content') });
  baseRun = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
});

function snapshotFor(run: ActiveRun): SessionSnapshot {
  const projection = projectGameplayState({ state: run, content: pack });
  return {
    projection, log: [], lastEvents: [], pendingDecision: null, notice: null, houseOpen: false, conclusion: null, sightings: { monsterIds: [], itemIds: [], landmarks: [] }, heroClassTags: [], onboarding: { counts: {}, dismissed: [] },
  };
}

function stubSession(snapshot: SessionSnapshot): GuestSession {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    dispatch: vi.fn(),
  } as unknown as GuestSession;
}

function renderSheet(snapshot: SessionSnapshot) {
  return render(
    <UiProviders pack={pack} settings={DEFAULT_SETTINGS} onChangeSettings={() => {}} session={stubSession(snapshot)}>
      <CharacterSheetOverlay />
    </UiProviders>,
  );
}

describe('CharacterSheetOverlay', () => {
  it('renders all six section headings', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);

    expect(screen.getByRole('heading', { name: 'Attributes' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Derived stats' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vitals' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Conditions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Equipment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Run statistics' })).toBeInTheDocument();
  });

  it('renders a sample attribute value', () => {
    const snapshot = snapshotFor(baseRun);
    renderSheet(snapshot);
    const hero = snapshot.projection.hero as unknown as { attributes: Readonly<Record<string, number>> };

    const attributesSection = within(screen.getByRole('heading', { name: 'Attributes' }).closest('section')!);
    expect(attributesSection.getByText('Might').nextElementSibling).toHaveTextContent(String(hero.attributes.might));
  });

  it('renders a condition badge with its inline color', () => {
    const hero = heroActor(baseRun);
    const applied = applyCondition({
      actors: baseRun.actors, content: pack, targetActorId: hero.actorId, sourceActorId: hero.actorId,
      conditionId: 'condition.disengaged', worldTime: baseRun.worldTime, eventId: 'event.test-condition',
    });
    const dungeonFloor = { ...baseRun.floors[0]!, depth: 1 };
    const dungeonRun: ActiveRun = {
      ...baseRun, actors: applied.actors,
      floors: [dungeonFloor, ...baseRun.floors.slice(1)],
    };
    const snapshot = snapshotFor(dungeonRun);
    const condition = (snapshot.projection.hero as unknown as {
      conditions: readonly { name: string; color: string }[];
    }).conditions[0]!;

    renderSheet(snapshot);

    const nameNode = screen.getByText(condition.name);
    expect(nameNode.closest('li')).toHaveStyle({ color: condition.color });
  });
});
