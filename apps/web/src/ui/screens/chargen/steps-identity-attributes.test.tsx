import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { HERO_NAME_RULES, type Uint32State } from '@woven-deep/engine';
import { initialWizardState, type WizardState } from '../../../session/wizard-reducer.js';
import { IdentityStep, AttributesStep } from './steps.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

beforeAll(async () => {
  pack = await compileContentDirectory({
    rootDir: resolve(import.meta.dirname, '../../../../../../content'),
  });
});

function stubState(overrides: Partial<WizardState> = {}): WizardState {
  return { ...initialWizardState(SEED), ...overrides };
}

describe('IdentityStep', () => {
  it('dispatches set-name when typing in the name field', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<IdentityStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.type(screen.getByRole('textbox'), 'R');
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-name', name: 'R' });
  });

  it('dispatches set-portrait when clicking a portrait option', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<IdentityStep state={stubState()} pack={pack} dispatch={dispatch} />);
    const options = screen.getAllByRole('option');
    await user.click(options[1]!);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'set-portrait' }));
  });

  it('⟳ RANDOM dispatches set-name with a name passing HERO_NAME_RULES', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<IdentityStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.click(screen.getByRole('button', { name: /random/i }));
    expect(dispatch).toHaveBeenCalledOnce();
    const action = dispatch.mock.calls[0]![0] as { type: string; name: string };
    expect(action.type).toBe('set-name');
    expect(action.name.length).toBeGreaterThanOrEqual(HERO_NAME_RULES.minLength);
    expect(action.name.length).toBeLessThanOrEqual(HERO_NAME_RULES.maxLength);
    expect(HERO_NAME_RULES.pattern.test(action.name)).toBe(true);
  });

  it('dispatches set-onboarding-enabled when the checkbox is toggled', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(
      <IdentityStep
        state={stubState({ onboardingEnabled: true })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    await user.click(screen.getByRole('checkbox'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'set-onboarding-enabled', enabled: false });
  });
});

describe('AttributesStep', () => {
  it('choosing ROLL 3D6 then Roll dispatches choose-method then roll', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    render(<AttributesStep state={stubState()} pack={pack} dispatch={dispatch} />);
    await user.click(screen.getByRole('option', { name: /roll 3d6/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'choose-method', method: 'roll' });

    dispatch.mockClear();
    render(
      <AttributesStep state={stubState({ method: 'roll' })} pack={pack} dispatch={dispatch} />,
    );
    await user.click(screen.getByRole('button', { name: /roll attributes/i }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'roll' });
  });

  it('reroll button is disabled once rerollUsed is true', () => {
    const dispatch = vi.fn();
    render(
      <AttributesStep
        state={stubState({
          method: 'roll',
          attributes: { might: 10, agility: 10, vitality: 10, wits: 10, resolve: 10 },
          rerollUsed: true,
        })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    expect(screen.getByRole('button', { name: /reroll/i })).toBeDisabled();
  });

  it('point-buy: + on an attribute dispatches set-attribute with value = current + 1', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const balance = pack.entries.find((entry) => entry.kind === 'balance') as {
      attributeMinimum: number;
      pointBuy: { costs: readonly { value: number; cost: number }[] };
    };
    const startValue = balance.attributeMinimum;
    const attributes = {
      might: startValue,
      agility: startValue,
      vitality: startValue,
      wits: startValue,
      resolve: startValue,
    };
    render(
      <AttributesStep
        state={stubState({ method: 'point-buy', attributes })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    const incrementButtons = screen.getAllByRole('button', { name: '+' });
    await user.click(incrementButtons[0]!);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'set-attribute',
      attribute: 'might',
      value: startValue + 1,
    });
  });

  it('point-buy: + is disabled (no dispatch) once the budget is exhausted', async () => {
    const user = userEvent.setup();
    const dispatch = vi.fn();
    const balance = pack.entries.find((entry) => entry.kind === 'balance') as {
      attributeMinimum: number;
      attributeMaximum: number;
      pointBuy: { budget: number; costs: readonly { value: number; cost: number }[] };
    };
    // Push every attribute up to whatever value first meets or exceeds the budget on its own,
    // so incrementing any further attribute would necessarily exceed it.
    const sorted = [...balance.pointBuy.costs].sort((a, b) => a.value - b.value);
    const overBudgetRow =
      sorted.find((row) => row.cost >= balance.pointBuy.budget) ?? sorted[sorted.length - 1]!;
    const attributes = {
      might: overBudgetRow.value,
      agility: balance.attributeMinimum,
      vitality: balance.attributeMinimum,
      wits: balance.attributeMinimum,
      resolve: balance.attributeMinimum,
    };
    render(
      <AttributesStep
        state={stubState({ method: 'point-buy', attributes })}
        pack={pack}
        dispatch={dispatch}
      />,
    );
    const mightPlus = screen.getAllByRole('button', { name: '+' })[0]!;
    expect(mightPlus).toBeDisabled();
    await user.click(mightPlus);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
