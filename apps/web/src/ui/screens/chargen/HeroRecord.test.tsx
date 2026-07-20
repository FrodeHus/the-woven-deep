import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { ATTRIBUTE_ORDER, rollAttributes, type Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { HeroRecord } from './HeroRecord.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];
const WAYFARER = 'class.wayfarer';
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

  it('shows a green delta for a derived stat with a background/trait modifier', () => {
    const state = stubState();
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave />);

    // deep-miner (+1 search) and keen-eyed (+2 search) combine to +3 search.
    expect(screen.getByText(/\+3/)).toBeInTheDocument();
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

  it('renders a blinking caret when the name is empty', () => {
    const state = stubState({ name: '' });
    render(<HeroRecord state={state} pack={pack} onWeave={vi.fn()} canWeave={false} />);
    expect(screen.getByTestId('hero-record-name-caret')).toBeInTheDocument();
  });
});
