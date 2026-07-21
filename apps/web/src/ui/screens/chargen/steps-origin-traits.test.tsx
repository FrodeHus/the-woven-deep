import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { OriginStep, TraitsStep } from './steps.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const CARAVAN_GUARD = 'background.caravan-guard';
const KEEN_EYED = 'trait.keen-eyed';
const SURE_FOOTED = 'trait.sure-footed';
const STEADY_HANDS = 'trait.steady-hands';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../../content'),
  });
});

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState(SEED), ...overrides };
}

describe('OriginStep', () => {
  it('dispatches choose-background when a background row is selected', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<OriginStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.click(screen.getByRole('option', { name: /Caravan guard/ }));
    expect(dispatch).toHaveBeenCalledWith({
      type: 'choose-background',
      backgroundId: CARAVAN_GUARD,
    });
  });

  it('shows the background stat modifier as meta text', () => {
    const dispatch = vi.fn();
    render(<OriginStep state={stubState()} pack={pack} dispatch={dispatch} />);
    const option = screen.getByRole('option', { name: /Deep miner/ });
    expect(option.textContent).toMatch(/\+1/);
  });

  it('reflects the selected background', () => {
    const dispatch = vi.fn();
    render(
      <OriginStep
        state={stubState({ backgroundId: CARAVAN_GUARD })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    expect(screen.getByRole('option', { name: /Caravan guard/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('TraitsStep', () => {
  it('dispatches toggle-trait when a trait row is selected', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<TraitsStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.click(screen.getByRole('option', { name: /Keen-eyed/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'toggle-trait', traitId: KEEN_EYED });
  });

  it('shows the n/2 selection indicator reflecting traitIds length', () => {
    const dispatch = vi.fn();
    render(
      <TraitsStep state={stubState({ traitIds: [KEEN_EYED] })} pack={pack} dispatch={dispatch} />,
    );
    expect(screen.getByText('1/2')).toBeInTheDocument();
  });

  it('marks unselected rows aria-disabled once two traits are already chosen', () => {
    const dispatch = vi.fn();
    render(
      <TraitsStep
        state={stubState({ traitIds: [KEEN_EYED, SURE_FOOTED] })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    const unselected = screen.getByRole('option', { name: /Steady hands/ });
    expect(unselected).toHaveAttribute('aria-disabled', 'true');
    const selected = screen.getByRole('option', { name: /Keen-eyed/ });
    expect(selected).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('renders an at-cap unselected trait as unavailable, not locked (no unlock-hint marker)', () => {
    const dispatch = vi.fn();
    render(
      <TraitsStep
        state={stubState({ traitIds: [KEEN_EYED, SURE_FOOTED] })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    const unselected = screen.getByRole('option', { name: /Steady hands/ });
    expect(unselected.textContent).not.toContain('⊘');
    expect(unselected.textContent).toContain('2/2 traits picked');
  });

  it('does not dispatch toggle-trait when clicking an aria-disabled row at the cap', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(
      <TraitsStep
        state={stubState({ traitIds: [KEEN_EYED, SURE_FOOTED] })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    await user.click(screen.getByRole('option', { name: /Steady hands/ }));
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'toggle-trait', traitId: STEADY_HANDS }),
    );
  });

  it('renders the category chips from the tag taxonomy, not the internal chargen marker', () => {
    const dispatch = vi.fn();
    render(<TraitsStep state={stubState()} pack={pack} dispatch={dispatch} />);
    expect(screen.getByRole('button', { name: 'combat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'survival' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'perception' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'darkness' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chargen' })).not.toBeInTheDocument();
  });

  it('filters the list to the combat category when the combat chip is clicked, and ALL clears it', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<TraitsStep state={stubState()} pack={pack} dispatch={dispatch} />);

    await user.click(screen.getByRole('button', { name: 'combat' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: /Brawler/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Sharpshooter/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ALL' }));
    expect(screen.getAllByRole('option')).toHaveLength(8);
  });
});
