import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { deriveActorStats, rollAttributes, type HeroChoices, type Uint32State } from '@woven-deep/engine';
import { ChargenScreen } from '../src/ui/screens/ChargenScreen.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const WAYFARER = 'class.wayfarer';
const ARCHIVIST = 'class.archivist';
const CARAVAN_GUARD = 'background.caravan-guard';
const KEEN_EYED = 'trait.keen-eyed';

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
});

function wayfarerKit(): { kitId: string; name: string } {
  const entry = pack.entries.find((candidate) => candidate.kind === 'class' && candidate.id === WAYFARER) as {
    kits: readonly { kitId: string; name: string }[];
  };
  return entry.kits[0]!;
}

describe('ChargenScreen', () => {
  it('advances from step 1 to step 2 via a typed name and a click on Next, then selects a method with arrow keys + Enter', async () => {
    const user = userEvent.setup();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    expect(screen.getByLabelText(/Step 1 of 7/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Rin');

    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeEnabled();
    await user.click(nextButton);

    expect(screen.getByLabelText(/Step 2 of 7/)).toBeInTheDocument();
    // The first method option auto-focuses on mount; ArrowDown moves to the second, Enter selects it.
    expect(screen.getByRole('option', { name: /Roll/ })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByRole('option', { name: 'Point buy' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText(/Step 3 of 7/)).toBeInTheDocument();
  });

  it('renders locked classes with their silhouette glyph, name, and unlock hint, and rejects selecting them', async () => {
    const user = userEvent.setup();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Rin');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('option', { name: /Roll/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Roll attributes' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText(/Step 4 of 7/)).toBeInTheDocument();

    const archivistOption = screen.getByRole('option', { name: /Archivist/ });
    expect(archivistOption).toHaveAttribute('aria-disabled', 'true');
    expect(archivistOption).toBeDisabled();
    expect(within(archivistOption).getByText(/Read three lore fragments/)).toBeInTheDocument();
    expect(within(archivistOption).getByText('A')).toBeInTheDocument();

    await user.click(archivistOption);
    expect(archivistOption).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

    await user.click(screen.getByRole('option', { name: /Wayfarer/ }));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('shows a live derived-stats preview that reflects rolled attributes', async () => {
    const user = userEvent.setup();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Rin');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('option', { name: /Roll/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Roll attributes' }));

    const balance = pack.entries.find((entry) => entry.kind === 'balance') as { formulas: unknown };
    const rolled = rollAttributes(SEED);
    const expectedStats = deriveActorStats({
      attributes: rolled.attributes,
      formulas: balance.formulas as never,
      equipmentModifiers: [],
      conditionModifiers: [],
      heroModifiers: [],
    });

    expect(screen.getByText(`Defense: ${expectedStats.defense}`)).toBeInTheDocument();
    expect(screen.getByText(`Max health: ${expectedStats.maxHealth}`)).toBeInTheDocument();
  });

  it('completes the wizard and calls onConfirm with the wizardChoices payload when Confirm is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={onConfirm} />);

    await user.type(screen.getByLabelText('Name'), 'Rin');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('option', { name: /Roll/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('button', { name: 'Roll attributes' }));
    const rolled = rollAttributes(SEED);
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('option', { name: /Wayfarer/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const kit = wayfarerKit();
    await user.click(screen.getByRole('option', { name: kit.name }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await user.click(screen.getByRole('option', { name: 'Caravan guard' }));
    await user.click(screen.getByRole('option', { name: 'Keen-eyed' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByLabelText(/Step 7 of 7/)).toBeInTheDocument();
    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton).toBeEnabled();
    await user.click(confirmButton);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const payload = onConfirm.mock.calls[0]![0] as HeroChoices;
    expect(payload).toEqual({
      name: 'Rin',
      method: 'roll',
      attributes: rolled.attributes,
      classId: WAYFARER,
      kitId: kit.kitId,
      backgroundId: CARAVAN_GUARD,
      traitIds: [KEEN_EYED],
    });
  });
});
