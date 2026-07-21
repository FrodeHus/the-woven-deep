import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { ReviewStep } from './steps.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const WAYFARER = 'class.wayfarer';
const CARAVAN_GUARD = 'background.caravan-guard';
const KEEN_EYED = 'trait.keen-eyed';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../../content'),
  });
});

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState(SEED), ...overrides };
}

describe('ReviewStep', () => {
  it('renders the chosen name, calling, kit, background, and traits', () => {
    const classEntry = pack.entries.find(
      (entry) => entry.kind === 'class' && entry.id === WAYFARER,
    ) as {
      name: string;
      kits: readonly { kitId: string; name: string }[];
    };
    const kit = classEntry.kits[0]!;
    const dispatch = vi.fn();
    render(
      <ReviewStep
        state={stubState({
          name: 'Rin',
          method: 'point-buy',
          attributes: {
            might: 10,
            agility: 10,
            vitality: 10,
            wits: 10,
            resolve: 10,
          },
          classId: WAYFARER,
          kitId: kit.kitId,
          backgroundId: CARAVAN_GUARD,
          traitIds: [KEEN_EYED],
        })}
        pack={pack}
        dispatch={dispatch}
      />,
    );

    expect(screen.getByText('Rin')).toBeInTheDocument();
    expect(screen.getByText(classEntry.name)).toBeInTheDocument();
    expect(screen.getByText(kit.name)).toBeInTheDocument();
    expect(screen.getByText('Caravan guard')).toBeInTheDocument();
    expect(screen.getByText('Keen-eyed')).toBeInTheDocument();
  });

  it('renders an attribute summary', () => {
    const dispatch = vi.fn();
    render(
      <ReviewStep
        state={stubState({
          method: 'point-buy',
          attributes: {
            might: 12,
            agility: 8,
            vitality: 9,
            wits: 11,
            resolve: 7,
          },
        })}
        pack={pack}
        dispatch={dispatch}
      />,
    );

    const attributes = screen.getByText('Attributes').closest('div');
    expect(attributes?.textContent).toContain('Might');
    expect(attributes?.textContent).toMatch(/Might.*12/);
    expect(attributes?.textContent).toMatch(/Agility.*8/);
  });

  it('falls back to placeholders when nothing is chosen yet', () => {
    const dispatch = vi.fn();
    render(<ReviewStep state={stubState()} pack={pack} dispatch={dispatch} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders the ready banner when every step is satisfied', () => {
    const classEntry = pack.entries.find(
      (entry) => entry.kind === 'class' && entry.id === WAYFARER,
    ) as { kits: readonly { kitId: string }[] };
    const kit = classEntry.kits[0]!;
    const dispatch = vi.fn();
    render(
      <ReviewStep
        state={stubState({
          name: 'Rin',
          method: 'point-buy',
          attributes: {
            might: 10,
            agility: 10,
            vitality: 10,
            wits: 10,
            resolve: 10,
          },
          classId: WAYFARER,
          kitId: kit.kitId,
          backgroundId: CARAVAN_GUARD,
          traitIds: [KEEN_EYED],
        })}
        pack={pack}
        dispatch={dispatch}
      />,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'Every thread is in place. Pull it — weave the hero and descend.',
    );
    expect(banner).toHaveClass('text-good');
  });

  it('renders the missing-threads banner naming the incomplete steps', () => {
    const dispatch = vi.fn();
    render(
      <ReviewStep
        state={stubState({
          name: 'Rin',
          method: 'point-buy',
          attributes: {
            might: 10,
            agility: 10,
            vitality: 10,
            wits: 10,
            resolve: 10,
          },
          classId: null,
          kitId: null,
          backgroundId: CARAVAN_GUARD,
          traitIds: [],
        })}
        pack={pack}
        dispatch={dispatch}
      />,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Threads are missing: Calling, Kit');
    expect(banner).toHaveClass('text-warn');
  });
});
