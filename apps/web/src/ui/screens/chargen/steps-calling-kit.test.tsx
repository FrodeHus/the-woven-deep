import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import type { Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { CallingStep, KitStep } from './steps.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const WAYFARER = 'class.wayfarer';
const ARCHIVIST = 'class.archivist';

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../../content'),
  });
});

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState(SEED), ...overrides };
}

describe('CallingStep', () => {
  it('dispatches choose-class when a playable class row is selected', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<CallingStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.click(screen.getByRole('option', { name: /Wayfarer/ }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'choose-class', classId: WAYFARER });
  });

  it('renders a locked class row as aria-disabled with its unlock hint, and does not dispatch on click', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<CallingStep state={stubState()} pack={pack} dispatch={dispatch} />);
    const archivistOption = screen.getByRole('option', { name: /Archivist/ });
    expect(archivistOption).toHaveAttribute('aria-disabled', 'true');
    expect(archivistOption.textContent).toMatch(/Read three lore fragments/);

    await user.click(archivistOption);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'choose-class', classId: ARCHIVIST }),
    );
  });

  it('dispatches choose-class when a class row is reached via arrow keys and selected with Enter', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<CallingStep state={stubState()} pack={pack} dispatch={dispatch} />);
    const options = screen.getAllByRole('option');
    const targetIndex = options.findIndex((option) => /Wayfarer/.test(option.textContent ?? ''));
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    options[0]!.focus();
    for (let i = 0; i < targetIndex; i += 1) {
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{Enter}');
    expect(dispatch).toHaveBeenCalledWith({ type: 'choose-class', classId: WAYFARER });
  });
});

describe('KitStep', () => {
  it('shows a message when no calling has been chosen yet', () => {
    const dispatch = vi.fn();
    render(<KitStep state={stubState({ classId: null })} pack={pack} dispatch={dispatch} />);
    expect(screen.getByText('Choose a calling first.')).toBeInTheDocument();
  });

  it('renders the chosen class kits and dispatches choose-kit on selection', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const classEntry = pack.entries.find(
      (entry) => entry.kind === 'class' && entry.id === WAYFARER,
    ) as {
      kits: readonly { kitId: string; name: string }[];
    };
    const kit = classEntry.kits[0]!;
    render(<KitStep state={stubState({ classId: WAYFARER })} pack={pack} dispatch={dispatch} />);

    const kitOption = screen.getByRole('option', { name: new RegExp(kit.name) });
    await user.click(kitOption);
    expect(dispatch).toHaveBeenCalledWith({ type: 'choose-kit', kitId: kit.kitId });
  });

  it('dispatches choose-kit when a kit row is reached via arrow keys and selected with Enter', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const classEntry = pack.entries.find(
      (entry) => entry.kind === 'class' && entry.id === WAYFARER,
    ) as {
      kits: readonly { kitId: string; name: string }[];
    };
    const kit = classEntry.kits[0]!;
    render(<KitStep state={stubState({ classId: WAYFARER })} pack={pack} dispatch={dispatch} />);

    const options = screen.getAllByRole('option');
    const targetIndex = options.findIndex((option) =>
      new RegExp(kit.name).test(option.textContent ?? ''),
    );
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    options[0]!.focus();
    for (let i = 0; i < targetIndex; i += 1) {
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{Enter}');
    expect(dispatch).toHaveBeenCalledWith({ type: 'choose-kit', kitId: kit.kitId });
  });
});
