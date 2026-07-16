import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { CompiledContentPack } from '@woven-deep/content';
import { compileContentDirectory } from '@woven-deep/content/compiler';
import { DEFAULT_GUEST_HERO, createNewRun, projectGameplayState, type GameplayProjection } from '@woven-deep/engine';
import type { SessionSnapshot } from '../src/session/guest-session.js';
import { BackpackMenu } from '../src/ui/BackpackMenu.js';

let pack: CompiledContentPack;
let baseProjection: GameplayProjection;

const SEED = [11, 22, 33, 44] as const;

beforeAll(async () => {
  pack = await compileContentDirectory({ rootDir: resolve(import.meta.dirname, '../../../content') });
  const run = createNewRun({ pack, seed: SEED, hero: DEFAULT_GUEST_HERO });
  baseProjection = projectGameplayState({ state: run, content: pack });
});

function snapshotWithBackpack(items: readonly Readonly<{ itemId: string; name: string }>[]): SessionSnapshot {
  return {
    projection: {
      ...baseProjection,
      hero: { ...baseProjection.hero, backpack: items },
    } as unknown as GameplayProjection,
    log: [],
    lastEvents: [],
    pendingDecision: null,
    notice: null,
    backpackOpen: true,
  };
}

describe('BackpackMenu', () => {
  it('lists backpack items, traps focus, dispatches equip/use/drop/toggle-light intents, and closes on Escape', async () => {
    const user = userEvent.setup();
    const onDispatch = vi.fn();
    const onClose = vi.fn();
    const snapshot = snapshotWithBackpack([
      { itemId: 'item.torch', name: 'Torch' },
      { itemId: 'item.potion', name: 'Potion' },
    ]);

    render(<BackpackMenu snapshot={snapshot} onDispatch={onDispatch} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: /backpack/i });
    expect(screen.getByText('Torch')).toBeInTheDocument();
    expect(screen.getByText('Potion')).toBeInTheDocument();

    // Focus starts on the list (its first focusable item) on open.
    const torchButton = screen.getByRole('button', { name: 'Torch' });
    const potionButton = screen.getByRole('button', { name: 'Potion' });
    expect(torchButton).toHaveFocus();

    // Tab wraps forward at the last focusable element back to the first.
    await user.tab();
    expect(potionButton).toHaveFocus();
    await user.tab();
    expect(torchButton).toHaveFocus();

    // Shift+Tab wraps backward from the first to the last.
    await user.tab({ shift: true });
    expect(potionButton).toHaveFocus();

    // Move selection down to Potion and use it.
    await user.keyboard('{ArrowDown}');
    await user.keyboard('u');
    expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'use', itemId: 'item.potion' });

    // Move selection back up to Torch and equip/drop/toggle-light it.
    await user.keyboard('{ArrowUp}');
    await user.keyboard('e');
    expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'equip', itemId: 'item.torch' });
    await user.keyboard('d');
    expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'drop', itemId: 'item.torch' });
    await user.keyboard('l');
    expect(onDispatch).toHaveBeenCalledWith({ type: 'backpack', action: 'toggle-light', itemId: 'item.torch' });

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();

    void dialog;
  });

  it('shows a placeholder when the backpack is empty', () => {
    render(<BackpackMenu snapshot={snapshotWithBackpack([])} onDispatch={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/backpack is empty/i)).toBeInTheDocument();
  });

  it('restores focus to whatever had it before the dialog opened, on close/unmount', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open backpack';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(
      <BackpackMenu snapshot={snapshotWithBackpack([{ itemId: 'item.torch', name: 'Torch' }])} onDispatch={vi.fn()} onClose={vi.fn()} />,
    );
    expect(opener).not.toHaveFocus();

    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
