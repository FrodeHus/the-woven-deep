import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { ATTRIBUTE_ORDER, rollAttributes, type Uint32State } from '@woven-deep/engine';
import {
  initialWizardState,
  PORTRAIT_GLYPH_COLOR,
  wizardReduce,
  type WizardState,
} from '../../../session/wizard-reducer.js';
import { HeroRecord } from './HeroRecord.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];
const WAYFARER = 'class.wayfarer';
const LOOMCALLER = 'class.loomcaller';
const DEEP_MINER = 'background.deep-miner';
const KEEN_EYED = 'trait.keen-eyed';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../../content'),
  });
});

function wayfarerKitId(): string {
  const entry = pack.entries.find(
    (candidate) => candidate.kind === 'class' && candidate.id === WAYFARER,
  ) as {
    kits: readonly { kitId: string }[];
  };
  return entry.kits[0]!.kitId;
}

function loomcallerKitId(): string {
  const entry = pack.entries.find(
    (candidate) => candidate.kind === 'class' && candidate.id === LOOMCALLER,
  ) as {
    kits: readonly { kitId: string }[];
  };
  return entry.kits[0]!.kitId;
}

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  const base = initialWizardState(SEED);
  const rolled = rollAttributes(SEED);
  return {
    ...base,
    step: 7,
    name: 'Rin',
    method: 'roll',
    attributes: rolled.attributes,
    rollState: rolled,
    classId: WAYFARER,
    kitId: wayfarerKitId(),
    backgroundId: DEEP_MINER,
    traitIds: [KEEN_EYED],
    ...overrides,
  };
}

describe('HeroRecord', () => {
  it('renders the name, each attribute, at least one derived stat, and the loadout', () => {
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    expect(screen.getByText('Rin')).toBeInTheDocument();
    for (const attributeName of ATTRIBUTE_ORDER) {
      expect(screen.getByText(new RegExp(`^${attributeName}$`, 'i'))).toBeInTheDocument();
    }
    expect(screen.getByText(/Iron sword/i)).toBeInTheDocument();
    expect(screen.getByText(/Lamp oil/i)).toBeInTheDocument();
  });

  it('renders a flat Gold row sourced from the pack balance, with no delta', () => {
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    const balance = pack.entries.find((entry) => entry.kind === 'balance') as {
      startingCurrency: number;
    };
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText(`${balance.startingCurrency}g`)).toBeInTheDocument();
  });

  it('shows a green delta for a derived stat with a background/trait modifier', () => {
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    // deep-miner (+1 search) and keen-eyed (+2 search) combine to +3 search.
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
  });

  it('shows a warn/danger-toned negative delta for a derived stat with a class penalty', () => {
    // The Loomcaller's class modifiers include defense: -2 -- a caster penalty, not a bonus.
    const state = stubState({ classId: LOOMCALLER, kitId: loomcallerKitId() });
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    const defenseDelta = screen.getByText('-2');
    expect(defenseDelta).toBeInTheDocument();
    expect(defenseDelta).toHaveClass('text-danger');
    expect(defenseDelta).not.toHaveClass('text-good');
  });

  it('shows a good-toned positive delta for a derived stat with a class bonus', () => {
    // The Loomcaller's class modifiers include search: 2 -- a positive bonus, stacked on top of
    // deep-miner's +1 and keen-eyed's +2 search from `stubState`'s defaults.
    const state = stubState({ classId: LOOMCALLER, kitId: loomcallerKitId() });
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    const searchDelta = screen.getByText('+5');
    expect(searchDelta).toBeInTheDocument();
    expect(searchDelta).toHaveClass('text-good');
    expect(searchDelta).not.toHaveClass('text-danger');
  });

  it('enables the WEAVE THE HERO button when canWeave and calls onWeave on click', async () => {
    const user = userEvent.setup();
    const onWeave = vi.fn();
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={onWeave} canWeave />);

    const weaveButton = screen.getByRole('button', { name: /WEAVE THE HERO/ });
    expect(weaveButton).toBeEnabled();
    await user.click(weaveButton);
    expect(onWeave).toHaveBeenCalledOnce();
  });

  it('disables the WEAVE THE HERO button when canWeave is false', () => {
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave={false} />);
    expect(screen.getByRole('button', { name: /WEAVE THE HERO/ })).toBeDisabled();
  });

  it('tints the portrait tile with the selected glyph colour, no class picked', () => {
    const state = wizardReduce(
      stubState({ classId: null, kitId: null }),
      { type: 'set-portrait', glyph: '@·ember' },
      { pack, seed: SEED },
    );
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave={false} />);
    expect(screen.getByTestId('hero-record-portrait')).toHaveStyle({
      color: PORTRAIT_GLYPH_COLOR['@·ember'],
    });
  });

  it('tints the portrait tile with a different colour for a different selected glyph', () => {
    const state = wizardReduce(
      stubState({ classId: null, kitId: null }),
      { type: 'set-portrait', glyph: '@·moss' },
      { pack, seed: SEED },
    );
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave={false} />);
    expect(screen.getByTestId('hero-record-portrait')).toHaveStyle({
      color: PORTRAIT_GLYPH_COLOR['@·moss'],
    });
  });

  it('renders a blinking caret when the name is empty', () => {
    const state = stubState({ name: '' });
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave={false} />);
    expect(screen.getByTestId('hero-record-name-caret')).toBeInTheDocument();
  });
});
