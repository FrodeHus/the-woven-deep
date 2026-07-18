import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { rollAttributes, type HeroChoices, type Uint32State } from '@woven-deep/engine';
import { ChargenScreen } from '../src/ui/screens/ChargenScreen.js';

let pack: CompiledContentPack;

const SEED: Uint32State = [11, 22, 33, 44];

const WAYFARER = 'class.wayfarer';
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

/** Drives the full seven-step console via clicks, up to (but not including) the final Weave
 * click, so callers can assert on state before confirming. */
async function driveToReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Name'), 'Rin');
  await user.click(screen.getByRole('button', { name: /NEXT/ }));

  await user.click(screen.getByRole('option', { name: /Wayfarer/ }));
  await user.click(screen.getByRole('button', { name: /NEXT/ }));

  const kit = wayfarerKit();
  await user.click(screen.getByRole('option', { name: new RegExp(kit.name) }));
  await user.click(screen.getByRole('button', { name: /NEXT/ }));

  await user.click(screen.getByRole('option', { name: /roll/i }));
  await user.click(screen.getByRole('button', { name: 'Roll attributes' }));
  await user.click(screen.getByRole('button', { name: /NEXT/ }));

  await user.click(screen.getByRole('option', { name: /Caravan guard/ }));
  await user.click(screen.getByRole('button', { name: /NEXT/ }));

  await user.click(screen.getByRole('option', { name: /Keen-eyed/ }));
  await user.click(screen.getByRole('button', { name: /NEXT/ }));
}

describe('ChargenScreen (console)', () => {
  it('renders the three panes: build-order menu, active step body, and hero record', () => {
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    expect(screen.getByRole('navigation', { name: 'Build order' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name and portrait')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Hero record' })).toBeInTheDocument();
  });

  it('WEAVE is disabled until step 7 with valid choices, and enables once the console reaches Review', async () => {
    const user = userEvent.setup();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    const heroRecord = screen.getByRole('region', { name: 'Hero record' });
    expect(within(heroRecord).getByRole('button', { name: /WEAVE/ })).toBeDisabled();

    await driveToReview(user);

    expect(screen.getByLabelText(/Step 7 of 7/)).toBeInTheDocument();
    expect(within(heroRecord).getByRole('button', { name: /WEAVE/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'WEAVE ▸' })).toBeEnabled();
  });

  it('jumping via the StepMenu resolves the Calling row to the class name, not the raw content id', async () => {
    const user = userEvent.setup();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={vi.fn()} />);

    await user.type(screen.getByLabelText('Name'), 'Rin');
    await user.click(screen.getByRole('button', { name: /NEXT/ }));
    await user.click(screen.getByRole('option', { name: /Wayfarer/ }));

    const callingRow = screen.getByRole('option', { name: /Calling/ });
    expect(callingRow.textContent).toMatch(/Wayfarer/);
    expect(callingRow.textContent).not.toMatch(WAYFARER);
  });

  it('completes the console and calls onConfirm with the wizardChoices payload + portrait glyph when WEAVE is pressed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ChargenScreen pack={pack} seed={SEED} onConfirm={onConfirm} />);

    await driveToReview(user);

    const rolled = rollAttributes(SEED);
    await user.click(screen.getByRole('button', { name: 'WEAVE ▸' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [payload, portraitGlyph] = onConfirm.mock.calls[0] as [HeroChoices, string];
    expect(payload).toEqual({
      name: 'Rin',
      method: 'roll',
      attributes: rolled.attributes,
      classId: WAYFARER,
      kitId: wayfarerKit().kitId,
      backgroundId: CARAVAN_GUARD,
      traitIds: [KEEN_EYED],
    });
    expect(typeof portraitGlyph).toBe('string');
    expect(portraitGlyph.length).toBeGreaterThan(0);
  });
});
